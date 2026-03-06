// packages/backend/src/engine/digest/context-inject.ts
import { z } from 'zod';
import { getLLMClient } from '../llm/client.js';
import type { RankedItem } from './ranking.js';
import { logger } from '../../shared/logger.js';

const contextResultSchema = z.array(
  z.object({
    id: z.number(),
    context: z.string().nullable(),
  }),
);

/**
 * Batch context injection: generate one-line background for each item.
 * Returns empty Map when LLM_PROVIDER=none.
 */
export async function batchContextInject(
  items: RankedItem[],
): Promise<Map<string, string>> {
  const llm = getLLMClient();

  if (!llm.isEnabled || items.length === 0) {
    return new Map();
  }

  const BATCH_SIZE = 8;
  const result = new Map<string, string>();

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);

    const prompt = `你是一个新闻背景注入器。对以下每条新闻标题，生成一句话（30字以内中文 / 50字以内英文）的背景上下文，帮助读者理解"这件事的来龙去脉"。
如果新闻本身就足够清晰不需要背景，返回 null。

Items:
${batch.map((it, idx) => `${idx + 1}. "${it.title}"`).join('\n')}

请返回 JSON 数组，每个元素包含 id (从1开始) 和 context (string 或 null)。`;

    try {
      const contexts = await llm.json(prompt, contextResultSchema);
      if (contexts) {
        for (const ctx of contexts) {
          if (ctx.context && ctx.id >= 1 && ctx.id <= batch.length) {
            result.set(batch[ctx.id - 1].id, ctx.context);
          }
        }
      }
    } catch (err) {
      logger.warn({ error: err, batchStart: i }, 'Context injection batch failed');
    }
  }

  logger.info({ total: items.length, injected: result.size }, 'Context injection complete');
  return result;
}
