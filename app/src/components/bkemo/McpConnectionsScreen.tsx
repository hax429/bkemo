import { useEffect, useState } from "react";
import copy from "copy-to-clipboard";
import { Icon } from "@/components/Common/Iconify/icons";
import { getBlinkoEndpoint } from "@/lib/blinkoEndpoint";
import { api } from "@/lib/trpc";

type McpView = "connect" | "outbound";

const field: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--bg)",
  color: "var(--fg)",
  border: "1px solid var(--border-2)",
  borderRadius: "var(--radius)",
  padding: "8px 10px",
  fontSize: 12.5,
};

const mono: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  color: "var(--fg-3)",
};

function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      className="bk-native-mini-button"
      title={`${label} to clipboard`}
      aria-label={`${label} to clipboard`}
      onClick={() => {
        if (!copy(text)) return;
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }}
      style={{ flexShrink: 0 }}
    >
      <Icon icon={copied ? "mdi:check" : "tabler:copy"} width={15} />
    </button>
  );
}

function CodeBlock({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ position: "relative" }}>
      <pre
        style={{
          boxSizing: "border-box",
          minHeight: 40,
          margin: 0,
          padding: "10px 48px 10px 12px",
          overflowX: "auto",
          border: "1px solid var(--border-2)",
          borderRadius: "var(--radius)",
          background: "var(--bg)",
          color: "var(--fg)",
          fontFamily: "var(--font-mono)",
          fontSize: 11.5,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </pre>
      <div style={{ position: "absolute", top: 6, right: 6 }}>
        <CopyButton text={value} label={label} />
      </div>
    </div>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "28px minmax(0, 1fr)",
        gap: 12,
        padding: "16px 0",
        borderTop: "1px solid var(--border)",
      }}
    >
      <span
        style={{
          width: 26,
          height: 26,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          border: "1px solid var(--border-2)",
          borderRadius: "50%",
          color: "var(--fg-2)",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
        }}
      >
        {number}
      </span>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            color: "var(--fg)",
            fontSize: 13.5,
            fontWeight: 600,
            marginBottom: 7,
          }}
        >
          {title}
        </div>
        {children}
      </div>
    </div>
  );
}

function ConnectClientsGuide() {
  const mcpUrl = getBlinkoEndpoint("/mcp");
  const addCommand = `codex mcp add bkemo --url ${mcpUrl}`;
  const loginCommand = "codex mcp login bkemo";
  const verifyCommand = "codex mcp list";
  const config = `[mcp_servers.bkemo]
url = "${mcpUrl}"
auth = "oauth"
default_tools_approval_mode = "writes"`;

  return (
    <div>
      <section
        style={{ paddingBottom: 22, borderBottom: "1px solid var(--border)" }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--fg)",
            marginBottom: 5,
          }}
        >
          Your MCP endpoint
        </div>
        <div
          style={{
            color: "var(--fg-2)",
            fontSize: 12.5,
            lineHeight: 1.55,
            marginBottom: 10,
          }}
        >
          Use this Streamable HTTP URL in an OAuth-capable agent client. The
          client handles sign-in and asks you to approve its scopes.
        </div>
        <CodeBlock value={mcpUrl} label="MCP endpoint" />
      </section>

      <section
        style={{ padding: "22px 0", borderBottom: "1px solid var(--border)" }}
      >
        <div
          className="h-stack"
          style={{
            alignItems: "flex-start",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 6,
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--fg)" }}>
              Connect Codex
            </div>
            <div
              style={{
                color: "var(--fg-2)",
                fontSize: 12.5,
                lineHeight: 1.55,
                marginTop: 4,
              }}
            >
              Codex desktop, CLI, and the IDE extension share MCP configuration
              on the same host.
            </div>
          </div>
          <span className="spacer" />
          <a
            className="bk-native-button is-secondary is-small"
            href="https://developers.openai.com/codex/mcp/"
            target="_blank"
            rel="noreferrer"
          >
            <Icon icon="tabler:link" width={14} /> Codex MCP docs
          </a>
        </div>

        <Step number={1} title="Add bkemo">
          <div
            style={{
              color: "var(--fg-2)",
              fontSize: 12.5,
              lineHeight: 1.55,
              marginBottom: 9,
            }}
          >
            Run this once in a terminal. Codex stores it in your MCP
            configuration.
          </div>
          <CodeBlock value={addCommand} label="Add command" />
        </Step>

        <Step number={2} title="Authenticate with bkemo">
          <div
            style={{
              color: "var(--fg-2)",
              fontSize: 12.5,
              lineHeight: 1.55,
              marginBottom: 9,
            }}
          >
            This opens bkemo in your browser. Sign in, review the requested
            scopes, then approve the connection.
          </div>
          <CodeBlock value={loginCommand} label="Login command" />
        </Step>

        <Step number={3} title="Verify and restart">
          <div
            style={{
              color: "var(--fg-2)",
              fontSize: 12.5,
              lineHeight: 1.55,
              marginBottom: 9,
            }}
          >
            Confirm that bkemo is listed, then restart Codex so its tools are
            available in a new task.
          </div>
          <CodeBlock value={verifyCommand} label="Verify command" />
        </Step>

        <details
          style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}
        >
          <summary
            style={{
              cursor: "pointer",
              color: "var(--fg-2)",
              fontSize: 12.5,
              fontWeight: 600,
            }}
          >
            Configure with config.toml instead
          </summary>
          <div
            style={{
              color: "var(--fg-3)",
              fontSize: 12,
              lineHeight: 1.55,
              margin: "9px 0",
            }}
          >
            Add this to <code style={mono}>~/.codex/config.toml</code> or a
            trusted project&apos;s <code style={mono}>.codex/config.toml</code>,
            then run the login command above.
          </div>
          <CodeBlock value={config} label="Codex configuration" />
        </details>
      </section>

      <section
        style={{ padding: "22px 0", borderBottom: "1px solid var(--border)" }}
      >
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: "var(--fg)",
            marginBottom: 5,
          }}
        >
          Codex desktop or IDE
        </div>
        <div style={{ color: "var(--fg-2)", fontSize: 12.5, lineHeight: 1.65 }}>
          Open <strong style={{ color: "var(--fg)" }}>Settings</strong> →{" "}
          <strong style={{ color: "var(--fg)" }}>MCP servers</strong> →{" "}
          <strong style={{ color: "var(--fg)" }}>Add server</strong>. Choose{" "}
          <strong style={{ color: "var(--fg)" }}>Streamable HTTP</strong>, paste
          the endpoint above, save, and restart. Select{" "}
          <strong style={{ color: "var(--fg)" }}>Authenticate</strong> when
          bkemo asks for OAuth.
        </div>
      </section>

      <section
        style={{ padding: "22px 0", borderBottom: "1px solid var(--border)" }}
      >
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: "var(--fg)",
            marginBottom: 5,
          }}
        >
          Other agent clients
        </div>
        <div style={{ color: "var(--fg-2)", fontSize: 12.5, lineHeight: 1.65 }}>
          Add the endpoint as a Streamable HTTP MCP server and choose OAuth when
          prompted. A compatible client discovers bkemo&apos;s authorization
          server, registers itself, uses PKCE, and returns you to the client
          after consent. No static bearer token or client secret is needed.
        </div>
      </section>

      <section style={{ paddingTop: 22 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(230px, 100%), 1fr))",
            gap: 0,
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: 14, borderBottom: "1px solid var(--border)" }}>
            <div
              className="h-stack"
              style={{
                gap: 7,
                color: "var(--fg)",
                fontSize: 12.5,
                fontWeight: 600,
                marginBottom: 5,
              }}
            >
              <Icon icon="hugeicons:authorized" width={15} /> OAuth only
            </div>
            <div
              style={{ color: "var(--fg-3)", fontSize: 11.5, lineHeight: 1.55 }}
            >
              REST API tokens are not MCP credentials. Revoke connected clients
              under Security &amp; API.
            </div>
          </div>
          <div style={{ padding: 14 }}>
            <div
              className="h-stack"
              style={{
                gap: 7,
                color: "var(--fg)",
                fontSize: 12.5,
                fontWeight: 600,
                marginBottom: 5,
              }}
            >
              <Icon icon="hugeicons:global" width={15} /> Public HTTPS
            </div>
            <div
              style={{ color: "var(--fg-3)", fontSize: 11.5, lineHeight: 1.55 }}
            >
              Remote clients need a reachable HTTPS origin. ChatGPT web uses
              installed plugins and does not read local Codex MCP configuration.
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export function McpConnectionsScreen() {
  const [view, setView] = useState<McpView>("connect");
  const [servers, setServers] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [headerName, setHeaderName] = useState("");
  const [headerValue, setHeaderValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () =>
    setServers((await api.mcpServers.list.query()) as any[]);
  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    setError("");
    setBusy(true);
    try {
      await api.mcpServers.create.mutate({
        name,
        url,
        type: "streamable-http",
        headers:
          headerName && headerValue ? { [headerName]: headerValue } : undefined,
        allowedTools: [],
        isEnabled: false,
      });
      setName("");
      setUrl("");
      setHeaderName("");
      setHeaderValue("");
      await load();
    } catch (reason: any) {
      setError(reason?.message || "Could not save connector.");
    } finally {
      setBusy(false);
    }
  };

  const discover = async (server: any) => {
    const result = await api.mcpServers.testConnection.mutate({
      id: server.id,
    });
    if (!result.success) {
      setError(result.error || "Connection failed.");
      return;
    }
    const discovered = result.tools?.map((tool) => tool.name) || [];
    await api.mcpServers.update.mutate({
      id: server.id,
      allowedTools: discovered,
    });
    await load();
  };

  return (
    <div>
      <div
        className="h-stack"
        style={{
          alignItems: "flex-start",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 18,
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 24,
              fontWeight: 600,
              color: "var(--fg)",
              margin: 0,
            }}
          >
            MCP
          </h2>
          <div style={{ color: "var(--fg-2)", fontSize: 13, marginTop: 4 }}>
            Connect agent clients to bkemo or manage remote tools used by bkemo
            AI.
          </div>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="MCP settings"
        style={{
          display: "inline-flex",
          gap: 3,
          padding: 3,
          marginBottom: 22,
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          background: "var(--bg-2)",
        }}
      >
        {(
          [
            { id: "connect", label: "Connect clients", icon: "tabler:users" },
            { id: "outbound", label: "Outbound tools", icon: "tabler:tool" },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={view === item.id}
            className={`bk-native-button is-small ${view === item.id ? "is-primary" : "is-ghost"}`}
            onClick={() => setView(item.id)}
          >
            <Icon icon={item.icon} width={14} /> {item.label}
          </button>
        ))}
      </div>

      {view === "connect" ? (
        <ConnectClientsGuide />
      ) : (
        <>
          <div
            className="h-stack"
            style={{
              alignItems: "flex-start",
              gap: 12,
              flexWrap: "wrap",
              marginBottom: 22,
            }}
          >
            <div>
              <div
                style={{ fontSize: 16, fontWeight: 600, color: "var(--fg)" }}
              >
                Remote servers
              </div>
              <div
                style={{
                  color: "var(--fg-2)",
                  fontSize: 12.5,
                  lineHeight: 1.55,
                  marginTop: 4,
                }}
              >
                Streamable HTTP tools that bkemo AI can call.
              </div>
            </div>
            <span className="spacer" />
            <button
              className="bk-native-button is-secondary"
              title="Disable every outbound MCP connector"
              onClick={async () => {
                if (
                  !window.confirm("Disable every outbound MCP connector now?")
                )
                  return;
                await api.mcpServers.emergencyDisable.mutate();
                await load();
              }}
            >
              <Icon icon="tabler:shield-off" width={15} /> Emergency disable
            </button>
          </div>

          <section
            style={{
              borderBottom: "1px solid var(--border)",
              paddingBottom: 22,
              marginBottom: 22,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
              Add remote server
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(min(280px, 100%), 1fr))",
                gap: 8,
              }}
            >
              <input
                style={field}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Name"
              />
              <input
                style={field}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/mcp"
              />
              <input
                style={field}
                value={headerName}
                onChange={(event) => setHeaderName(event.target.value)}
                placeholder="Optional header name"
              />
              <input
                style={field}
                type="password"
                value={headerValue}
                onChange={(event) => setHeaderValue(event.target.value)}
                placeholder="Optional secret value"
              />
            </div>
            <div className="h-stack" style={{ gap: 10, marginTop: 10 }}>
              {error && (
                <span style={{ color: "var(--urgent)", fontSize: 12 }}>
                  {error}
                </span>
              )}
              <span className="spacer" />
              <button
                className="bk-native-button is-primary"
                disabled={busy || !name.trim() || !url.trim()}
                onClick={create}
              >
                <Icon icon="tabler:plus" width={15} />{" "}
                {busy ? "Saving..." : "Add disabled connector"}
              </button>
            </div>
          </section>

          <div className="v-stack" style={{ gap: 8 }}>
            {servers.length === 0 && (
              <div
                style={{
                  color: "var(--fg-3)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                }}
              >
                No outbound MCP servers.
              </div>
            )}
            {servers.map((server) => (
              <div
                key={server.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  background: "var(--bg-2)",
                  padding: 13,
                }}
              >
                <div className="h-stack" style={{ gap: 10 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        color: "var(--fg)",
                        fontSize: 13.5,
                        fontWeight: 600,
                      }}
                    >
                      {server.name}
                    </div>
                    <div
                      style={{
                        color: "var(--fg-3)",
                        fontFamily: "var(--font-mono)",
                        fontSize: 10.5,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {server.url}
                    </div>
                  </div>
                  <button
                    className="bk-native-mini-button"
                    title="Connect and allow discovered tools"
                    onClick={() => discover(server)}
                  >
                    <Icon icon="tabler:plug-connected" width={15} />
                  </button>
                  <button
                    className="bk-native-mini-button"
                    title={
                      server.isEnabled
                        ? "Disable connector"
                        : "Enable connector"
                    }
                    onClick={async () => {
                      await api.mcpServers.toggle.mutate({
                        id: server.id,
                        enabled: !server.isEnabled,
                      });
                      await load();
                    }}
                  >
                    <Icon
                      icon={
                        server.isEnabled
                          ? "tabler:toggle-right"
                          : "tabler:toggle-left"
                      }
                      width={17}
                    />
                  </button>
                  <button
                    className="bk-native-mini-button"
                    title="Delete connector"
                    onClick={async () => {
                      if (!window.confirm(`Delete ${server.name}?`)) return;
                      await api.mcpServers.delete.mutate({ id: server.id });
                      await load();
                    }}
                  >
                    <Icon icon="tabler:trash" width={15} />
                  </button>
                </div>
                <div
                  style={{ marginTop: 9, color: "var(--fg-2)", fontSize: 11.5 }}
                >
                  {server.isEnabled ? "Enabled" : "Disabled"} ·{" "}
                  {(server.allowedTools as string[]).length} allowed tool(s)
                  {server.lastStatus ? ` · ${server.lastStatus}` : ""}
                </div>
                {(server.allowedTools as string[]).length > 0 && (
                  <div
                    className="h-stack"
                    style={{ gap: 5, flexWrap: "wrap", marginTop: 8 }}
                  >
                    {(server.allowedTools as string[]).map((tool) => (
                      <code
                        key={tool}
                        style={{
                          fontSize: 10.5,
                          color: "var(--accent)",
                          border: "1px solid var(--border-2)",
                          borderRadius: 4,
                          padding: "2px 5px",
                        }}
                      >
                        {tool}
                      </code>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
