// packages/backend/src/engine/llm/client.ts
import { generateText, generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import { logger } from '../../shared/logger.js';

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

  async text(prompt: string, system?: string): Promise<string> {
    if (!this.isEnabled) return '';

    try {
      const model = await this.getModel();
      const { text } = await generateText({ model, system, prompt });
      return text;
    } catch (err) {
      logger.error({ error: err }, 'LLM text generation failed');
      return '';
    }
  }

  async json<T>(prompt: string, schema: z.ZodSchema<T>, system?: string): Promise<T | null> {
    if (!this.isEnabled) return null;

    try {
      const model = await this.getModel();
      const { object } = await generateObject({ model, system, prompt, schema });
      return object;
    } catch (err) {
      logger.error({ error: err }, 'LLM JSON generation failed');
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
