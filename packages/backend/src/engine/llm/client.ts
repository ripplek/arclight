// packages/backend/src/engine/llm/client.ts
import { generateText, generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import { logger } from '../../shared/logger.js';

function extractJsonPayload(text: string): string {
  const withoutFences = text.replace(/```json?\n?/gi, '').replace(/```\n?/g, '').trim();
  const firstBrace = withoutFences.indexOf('{');
  const firstBracket = withoutFences.indexOf('[');
  const firstCandidates = [firstBrace, firstBracket].filter((idx) => idx >= 0);

  if (firstCandidates.length === 0) return withoutFences;

  const start = Math.min(...firstCandidates);
  const lastBrace = withoutFences.lastIndexOf('}');
  const lastBracket = withoutFences.lastIndexOf(']');
  const end = Math.max(lastBrace, lastBracket);

  if (end < start) return withoutFences;
  return withoutFences.slice(start, end + 1).trim();
}

function serializeError(err: unknown): Record<string, unknown> {
  if (!err || typeof err !== 'object') {
    return { message: String(err) };
  }

  const error = err as Record<string, unknown> & {
    name?: string;
    message?: string;
    cause?: unknown;
    statusCode?: number;
    responseBody?: string;
    url?: string;
  };

  return {
    name: error.name,
    message: error.message,
    cause: error.cause,
    statusCode: error.statusCode,
    responseBody: error.responseBody,
    url: error.url,
  };
}

export type LLMProvider = 'openai' | 'anthropic' | 'ollama' | 'none';

export interface LLMClientConfig {
  provider: LLMProvider;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * LLM Client wrapper.
 * Supports provider=none graceful degradation (all methods return empty).
 */
export class LLMClient {
  private config: LLMClientConfig;
  private _model: LanguageModel | null = null;

  constructor(config?: LLMClientConfig) {
    this.config = config || {
      provider: (process.env.LLM_PROVIDER as LLMProvider) || 'none',
      model: process.env.LLM_MODEL,
      apiKey: process.env.LLM_API_KEY,
      baseUrl: process.env.LLM_BASE_URL || process.env.OLLAMA_BASE_URL,
    };
  }

  get isEnabled(): boolean {
    return this.config.provider !== 'none';
  }

  /** Lazy-init the language model */
  private async getModel(): Promise<LanguageModel> {
    if (this._model) return this._model;

    switch (this.config.provider) {
      case 'openai': {
        const { openai } = await import('@ai-sdk/openai');
        this._model = openai(this.config.model || 'gpt-4o-mini');
        break;
      }
      case 'anthropic': {
        const { createAnthropic } = await import('@ai-sdk/anthropic');
        const anthropic = createAnthropic({
          ...(this.config.baseUrl ? { baseURL: this.config.baseUrl } : {}),
          ...(this.config.apiKey ? { apiKey: this.config.apiKey } : {}),
        });
        this._model = anthropic(this.config.model || 'claude-sonnet-4-20250514');
        break;
      }
      case 'ollama': {
        const { createOpenAI } = await import('@ai-sdk/openai');
        const ollama = createOpenAI({
          baseURL: this.config.baseUrl || 'http://localhost:11434/v1',
          apiKey: 'ollama',
        });
        this._model = ollama(this.config.model || 'llama3.2');
        break;
      }
      default:
        throw new Error(`LLM provider "${this.config.provider}" not supported`);
    }

    return this._model!;
  }

  private shouldPreferTextJson(schema: z.ZodSchema<unknown>): boolean {
    return this.config.provider === 'anthropic' && Boolean(this.config.baseUrl) && schema instanceof z.ZodArray;
  }

  private async parseJsonText<T>(
    text: string,
    schema: z.ZodSchema<T>,
    model: LanguageModel,
    system?: string,
  ): Promise<T> {
    const cleaned = extractJsonPayload(text);

    try {
      return schema.parse(JSON.parse(cleaned));
    } catch (err) {
      logger.warn({ error: serializeError(err) }, 'LLM JSON parse failed, attempting repair');

      const repairPrompt = [
        '下面是一段本应为 JSON 但格式不合法的内容。',
        '请在不改动语义的前提下，将它修复为严格合法、可被 JSON.parse 的 JSON。',
        '要求：',
        '1. 只返回 JSON',
        '2. 不要 markdown 代码块',
        '3. 保持原有数组/对象结构与字段名',
        '',
        cleaned,
      ].join('\n');

      const { text: repairedText } = await generateText({ model, system, prompt: repairPrompt });
      const repaired = extractJsonPayload(repairedText);
      return schema.parse(JSON.parse(repaired));
    }
  }

  async text(prompt: string, system?: string): Promise<string> {
    if (!this.isEnabled) return '';

    try {
      const model = await this.getModel();
      const { text } = await generateText({ model, system, prompt });
      return text;
    } catch (err) {
      logger.error({ error: serializeError(err) }, 'LLM text generation failed');
      return '';
    }
  }

  async json<T>(prompt: string, schema: z.ZodSchema<T>, system?: string): Promise<T | null> {
    if (!this.isEnabled) return null;

    try {
      const model = await this.getModel();

      if (!this.shouldPreferTextJson(schema)) {
        try {
          const { object } = await generateObject({ model, system, prompt, schema });
          return object;
        } catch (err) {
          logger.info({ error: serializeError(err) }, 'generateObject failed, falling back to text-based JSON parsing');
        }
      } else {
        logger.info('Skipping generateObject for Anthropic proxy array schema; using text-based JSON parsing');
      }

      const jsonPrompt = [
        prompt,
        '',
        '请只返回 JSON，不要包含任何其他文字或 markdown 代码块。',
        '返回内容必须是严格合法的 JSON。所有字符串值内部若需要引号，请使用中文引号，或转义为 \\"。',
      ].join('\n');
      const { text } = await generateText({ model, system, prompt: jsonPrompt });
      return await this.parseJsonText(text, schema, model, system);
    } catch (err) {
      logger.error({ error: serializeError(err) }, 'LLM JSON generation failed');
      return null;
    }
  }
}

// Singleton
let llmInstance: LLMClient | null = null;

export function getLLMClient(): LLMClient {
  if (!llmInstance) {
    llmInstance = new LLMClient();
  }
  return llmInstance;
}
