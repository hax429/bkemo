import { LanguageModelV1 } from '@ai-sdk/provider';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOllama } from 'ollama-ai-provider';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createXai } from '@ai-sdk/xai';
import { createAzure } from '@ai-sdk/azure';
import { BaseProvider } from './BaseProvider';

interface LLMConfig {
  provider: string;
  apiKey?: any;
  baseURL?: any;
  modelKey: string;
  apiVersion?: any;
}

/** SiliconFlow (and similar) reject multiple/mid-thread system messages. */
function normalizeChatMessages(messages: any[]): any[] {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  const systems: any[] = [];
  const rest: any[] = [];
  for (const message of messages) {
    if (message?.role === 'system') systems.push(message);
    else rest.push(message);
  }
  if (systems.length === 0) return messages;
  const content = systems
    .map((message) => {
      if (typeof message.content === 'string') return message.content;
      if (Array.isArray(message.content)) {
        return message.content
          .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
          .filter(Boolean)
          .join('\n');
      }
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
  return content ? [{ role: 'system', content }, ...rest] : rest;
}

function withChatThinkingDisabled(baseFetch: typeof fetch | undefined): typeof fetch {
  const fetchImpl = baseFetch ?? fetch;
  return async (input, init) => {
    const url = String(typeof input === 'string' ? input : (input as Request)?.url ?? '');
    const t0 = Date.now();
    if (url.includes('/chat/completions') && init?.body && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body);
        const model = typeof body.model === 'string' ? body.model : '';
        if (Array.isArray(body.messages)) {
          body.messages = normalizeChatMessages(body.messages);
        }
        // DeepSeek V4 defaults thinking ON. On SiliconFlow, `enable_thinking: false`
        // is ignored/harmful for V4-Flash and can hang TTFT for 40s+; only
        // `thinking: { type: "disabled" }` reliably selects the non-think path.
        if (/deepseek/i.test(model)) {
          delete body.enable_thinking;
          body.thinking = { type: 'disabled' };
        } else if (/qwen/i.test(model)) {
          // Qwen3 on SiliconFlow also defaults thinking ON; disable for chat TTFT.
          body.enable_thinking = false;
        }
        init = { ...init, body: JSON.stringify(body) };
        if (process.env.NODE_ENV !== 'production') {
          const roles = Array.isArray(body.messages)
            ? body.messages.map((m: any) => m?.role)
            : [];
          console.log('[LLMProvider] chat/completions →', {
            model,
            stream: Boolean(body.stream),
            thinking: body.thinking ?? null,
            enable_thinking: body.enable_thinking ?? null,
            msgCount: roles.length,
            roles,
            tools: Array.isArray(body.tools) ? body.tools.length : 0,
          });
        }
      } catch {
        // leave body untouched
      }
    }
    try {
      const res = await fetchImpl(input as any, init as any);
      if (!url.includes('/chat/completions')) return res;

      if (!(res as Response).ok) {
        let errBody = '';
        try {
          errBody = (await (res as Response).text()).slice(0, 800);
        } catch {
          errBody = '(unreadable)';
        }
        let detail = errBody;
        try {
          const parsed = JSON.parse(errBody);
          detail = parsed?.message || parsed?.error?.message || errBody;
        } catch {
          // keep raw body
        }
        console.error('[LLMProvider] chat/completions ←', {
          status: (res as Response).status,
          ms: Date.now() - t0,
          body: errBody,
        });
        // Fail fast: some SDK/stream paths hang on 4xx instead of surfacing an error,
        // which left the UI waiting until the client abort timeout (~5–15m).
        throw new Error(`LLM provider ${(res as Response).status}: ${detail}`);
      }

      if (process.env.NODE_ENV !== 'production') {
        console.log('[LLMProvider] chat/completions ←', { status: (res as Response).status, ms: Date.now() - t0 });
      }
      return res;
    } catch (error) {
      if (process.env.NODE_ENV !== 'production' && url.includes('/chat/completions')) {
        console.error('[LLMProvider] chat/completions error', { ms: Date.now() - t0, error });
      }
      throw error;
    }
  };
}

export class LLMProvider extends BaseProvider {
  async getLanguageModel(config: LLMConfig): Promise<LanguageModelV1> {
    await this.ensureInitialized();
    const chatFetch = withChatThinkingDisabled(this.proxiedFetch);
    switch (config.provider.toLowerCase()) {
      case 'openai':
        return createOpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseURL || undefined,
          fetch: chatFetch
        }).languageModel(config.modelKey);

      case 'anthropic':
        return createAnthropic({
          apiKey: config.apiKey,
          baseURL: config.baseURL || undefined,
          fetch: this.proxiedFetch
        }).languageModel(config.modelKey);

      case 'gemini':
      case 'google':
        return createGoogleGenerativeAI({
          apiKey: config.apiKey,
          fetch: this.proxiedFetch
        }).languageModel(config.modelKey);

      case 'ollama':
        return createOllama({
          baseURL: config.baseURL?.trim().replace(/\/api$/, '') + '/api' || undefined,
          fetch: this.proxiedFetch
        }).languageModel(config.modelKey);

      case 'deepseek':
        return createDeepSeek({
          apiKey: config.apiKey,
          fetch: chatFetch
        }).languageModel(config.modelKey);

      case 'openrouter':
        return createOpenRouter({
          apiKey: config.apiKey,
          fetch: this.proxiedFetch
        }).languageModel(config.modelKey);

      case 'grok':
      case 'xai':
        return createXai({
          apiKey: config.apiKey,
          fetch: this.proxiedFetch
        }).languageModel(config.modelKey);

      case 'azureopenai':
      case 'azure':
        return createAzure({
          apiKey: config.apiKey,
          baseURL: config.baseURL || undefined,
          apiVersion: config.apiVersion || undefined,
          fetch: this.proxiedFetch
        }).languageModel(config.modelKey);

      case 'minimax':
        return createOpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseURL || 'https://api.minimax.io/v1',
          fetch: chatFetch
        }).languageModel(config.modelKey);

      case 'custom':
      case 'siliconflow':
      default:
        return createOpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseURL || undefined,
          fetch: chatFetch
        }).languageModel(config.modelKey);
    }
  }
}