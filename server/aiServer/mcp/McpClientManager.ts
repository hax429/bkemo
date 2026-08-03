import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { lookup as dnsLookup } from 'dns';
import { Agent, fetch as undiciFetch } from 'undici';
import { prisma } from '@server/prisma';
import type { mcpServers } from '@prisma/client';
import { assertSafeOutboundUrl, isPrivateOrSpecialIp } from '@server/lib/safeOutboundUrl';
import { decryptStorageCredential } from '@server/lib/storageCredentialEncryption';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, any>;
  serverId: number;
  serverName: string;
}

interface McpConnection {
  client: Client;
  transport: StreamableHTTPClientTransport;
  tools: McpTool[];
  lastUsed: number;
  serverId: number;
  serverName: string;
  timeoutMs: number;
  maxResultBytes: number;
  allowedTools: Set<string>;
  dispatcher: Agent;
}

const IDLE_TIMEOUT = 5 * 60 * 1000;
const CLEANUP_INTERVAL = 60 * 1000;

function createSafeDispatcher() {
  return new Agent({
    connect: {
      lookup: (hostname: string, options: any, callback: any) => {
        dnsLookup(hostname, { family: options?.family, hints: options?.hints, all: true, verbatim: true }, (error, addresses) => {
          if (error) return callback(error);
          const records = Array.isArray(addresses) ? addresses : [addresses];
          if (!records.length || records.some((record) => isPrivateOrSpecialIp(record.address))) {
            return callback(new Error('Outbound MCP DNS resolution was rejected'));
          }
          const selected = records[0];
          callback(null, selected.address, selected.family);
        });
      },
    },
  });
}

function limitedResponse(response: any, maxBytes: number) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) {
    response.body?.cancel();
    throw new Error('Outbound MCP response exceeds configured size limit');
  }
  if (!response.body) return response;

  const reader = response.body.getReader();
  let received = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = await reader.read();
      if (chunk.done) {
        controller.close();
        return;
      }
      received += chunk.value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        controller.error(new Error('Outbound MCP response exceeds configured size limit'));
        return;
      }
      controller.enqueue(chunk.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function safeFetch(dispatcher: Agent, timeoutMs: number, maxBytes: number, url: string | URL, init?: RequestInit) {
  const checked = await assertSafeOutboundUrl(String(url));
  if (!checked.ok) throw new Error(`Outbound MCP URL rejected: ${checked.reason}`);
  if (process.env.NODE_ENV === 'production' && checked.url.protocol !== 'https:') throw new Error('Production MCP connectors require HTTPS');
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  const response = await undiciFetch(checked.url, {
    ...init,
    signal,
    redirect: 'manual',
    dispatcher,
  } as any);
  if (response.status >= 300 && response.status < 400) throw new Error('Outbound MCP redirects are not allowed');
  return limitedResponse(response, maxBytes);
}

function decryptHeaders(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, secret]) => [key, decryptStorageCredential(secret)]));
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  return Promise.race<T>([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

export class McpClientManager {
  private static instance: McpClientManager;
  private connections = new Map<number, McpConnection>();
  private connecting = new Map<number, Promise<McpConnection>>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  private constructor() {
    this.cleanupTimer = setInterval(() => void this.cleanupIdleConnections(), CLEANUP_INTERVAL);
  }

  static getInstance() {
    if (!McpClientManager.instance) McpClientManager.instance = new McpClientManager();
    return McpClientManager.instance;
  }

  private async cleanupIdleConnections() {
    const stale = [...this.connections.entries()].filter(([, connection]) => Date.now() - connection.lastUsed > IDLE_TIMEOUT);
    await Promise.all(stale.map(([id]) => this.disconnect(id)));
  }

  async connect(serverId: number, allowDisabled = false) {
    const existing = this.connections.get(serverId);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing;
    }
    const pending = this.connecting.get(serverId);
    if (pending) return pending;
    const promise = this.createConnection(serverId, allowDisabled);
    this.connecting.set(serverId, promise);
    try {
      const connection = await promise;
      this.connections.set(serverId, connection);
      return connection;
    } finally {
      this.connecting.delete(serverId);
    }
  }

  private async createConnection(serverId: number, allowDisabled: boolean): Promise<McpConnection> {
    const config = await prisma.mcpServers.findUnique({ where: { id: serverId } });
    if (!config || (!config.isEnabled && !allowDisabled)) throw new Error('MCP connector is missing or disabled');
    if (config.type !== 'streamable-http' || !config.url) throw new Error('Only Streamable HTTP MCP connectors are supported');
    const safe = await assertSafeOutboundUrl(config.url);
    if (!safe.ok) throw new Error(`Outbound MCP URL rejected: ${safe.reason}`);

    const dispatcher = createSafeDispatcher();
    const transport = this.createTransport(config, dispatcher);
    const client = new Client({ name: 'bkemo-mcp-client', version: '2.0.0' });
    try {
      await withTimeout(client.connect(transport), config.timeoutMs, 'MCP connection timeout');
      const response = await withTimeout(client.listTools(), config.timeoutMs, 'MCP tool discovery timeout');
      const tools = (response.tools || []).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Record<string, any>,
        serverId,
        serverName: config.name,
      }));
      await prisma.mcpServers.update({ where: { id: serverId }, data: { lastStatus: 'connected', lastError: null, lastUsedAt: new Date() } });
      return {
        client,
        transport,
        tools,
        lastUsed: Date.now(),
        serverId,
        serverName: config.name,
        timeoutMs: config.timeoutMs,
        maxResultBytes: config.maxResultBytes,
        allowedTools: new Set(Array.isArray(config.allowedTools) ? config.allowedTools as string[] : []),
        dispatcher,
      };
    } catch (error) {
      await client.close().catch(() => undefined);
      await dispatcher.close().catch(() => undefined);
      await prisma.mcpServers.update({
        where: { id: serverId },
        data: { lastStatus: 'error', lastError: error instanceof Error ? error.message.slice(0, 500) : 'Connection failed' },
      }).catch(() => undefined);
      throw new Error('Failed to connect to MCP server');
    }
  }

  private createTransport(config: mcpServers, dispatcher: Agent) {
    return new StreamableHTTPClientTransport(new URL(config.url!), {
      requestInit: { headers: decryptHeaders(config.headers) },
      fetch: (url, init) => safeFetch(dispatcher, config.timeoutMs, config.maxResultBytes + 256 * 1024, url, init) as any,
      reconnectionOptions: { initialReconnectionDelay: 1000, maxReconnectionDelay: 5000, reconnectionDelayGrowFactor: 1.5, maxRetries: 1 },
    });
  }

  async disconnect(serverId: number) {
    const connection = this.connections.get(serverId);
    if (!connection) return;
    this.connections.delete(serverId);
    await connection.client.close().catch(() => undefined);
    await connection.dispatcher.close().catch(() => undefined);
  }

  async disconnectAll() {
    await Promise.all([...this.connections.keys()].map((id) => this.disconnect(id)));
  }

  async getTools(serverId: number, options: { allowDisabled?: boolean; includeDisallowed?: boolean } = {}) {
    const connection = await this.connect(serverId, options.allowDisabled);
    return options.includeDisallowed
      ? connection.tools
      : connection.tools.filter((tool) => connection.allowedTools.has(tool.name));
  }

  async getAllEnabledTools() {
    const servers = await prisma.mcpServers.findMany({ where: { isEnabled: true, type: 'streamable-http' } });
    const tools: McpTool[] = [];
    for (const server of servers) {
      try {
        const connection = await this.connect(server.id);
        tools.push(...connection.tools.filter((tool) => connection.allowedTools.has(tool.name)));
      } catch {
        // A failed connector does not block healthy connectors.
      }
    }
    return tools;
  }

  async callTool(serverId: number, toolName: string, args: Record<string, any>) {
    const connection = await this.connect(serverId);
    if (!connection.allowedTools.has(toolName)) throw new Error('MCP tool is not allowed by connector policy');
    connection.lastUsed = Date.now();
    const result = await withTimeout(connection.client.callTool({ name: toolName, arguments: args }) as Promise<any>, connection.timeoutMs, 'MCP tool timeout');
    const bytes = Buffer.byteLength(JSON.stringify(result));
    if (bytes > connection.maxResultBytes) throw new Error('MCP tool result exceeds configured size limit');
    await prisma.mcpServers.update({ where: { id: serverId }, data: { lastUsedAt: new Date(), lastStatus: 'connected' } }).catch(() => undefined);
    return result;
  }

  isConnected(serverId: number) {
    return this.connections.has(serverId);
  }

  async getConnectionStatus() {
    const servers = await prisma.mcpServers.findMany({ where: { isEnabled: true } });
    return servers.map((server) => {
      const connection = this.connections.get(server.id);
      return {
        serverId: server.id,
        serverName: server.name,
        isConnected: Boolean(connection),
        toolCount: connection?.tools.filter((tool) => connection.allowedTools.has(tool.name)).length || 0,
        lastUsed: connection ? new Date(connection.lastUsed) : undefined,
      };
    });
  }

  async refreshTools(serverId: number) {
    await this.disconnect(serverId);
    return this.getTools(serverId);
  }

  stopCleanup() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
  }
}

export const mcpClientManager = McpClientManager.getInstance();
