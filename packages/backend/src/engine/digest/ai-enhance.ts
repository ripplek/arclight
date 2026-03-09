// packages/backend/src/engine/digest/ai-enhance.ts
// Single LLM call to enhance all digest items: categorize, translate, summarize
import { z } from 'zod';
import { getLLMClient } from '../llm/client.js';
import type { RankedItem } from './ranking.js';
import type { ArcStatus } from '../arc/types.js';
import type { ItemArcInfo } from './arc-context.js';
import { logger } from '../../shared/logger.js';

/** AI-enhanced metadata for each item */
export interface EnhancedMeta {
  category: string;
  categoryEmoji: string;
  chineseTitle: string;
  summary: string; // 1-2 sentence Chinese summary
  whyImportant?: string; // "为什么重要" (daily/deep only)
  context?: string; // background context
}

export interface EnhancedItem extends RankedItem {
  enhanced?: EnhancedMeta;
  arcInfo?: {
    id: string;
    title: string;
    status: ArcStatus;
    summary: string | null;
  };
}

const enhanceResultSchema = z.array(
  z.object({
    id: z.number(),
    category: z.string(),
    categoryEmoji: z.string(),
    chineseTitle: z.string(),
    summary: z.string(),
    whyImportant: z.string().nullable().optional(),
    context: z.string().nullable().optional(),
  }),
);

/**
 * Enhance digest items with AI-generated metadata in a single batch call.
 * Falls back gracefully: returns items unchanged if LLM fails.
 */
export async function aiEnhanceItems(
  items: RankedItem[],
  options: { includeWhyImportant?: boolean; itemArcMap?: Map<string, ItemArcInfo> } = {},
): Promise<EnhancedItem[]> {
  const llm = getLLMClient();

  if (!llm.isEnabled || items.length === 0) {
    logger.info('AI enhance skipped: LLM disabled or no items');
    return items;
  }

  const BATCH_SIZE = 10;
  const enhancedMap = new Map<number, EnhancedMeta>();

  for (let batchStart = 0; batchStart < items.length; batchStart += BATCH_SIZE) {
    const batch = items.slice(batchStart, batchStart + BATCH_SIZE);

    const itemList = batch
      .map((it, idx) => {
        const snippet = it.content ? it.content.slice(0, 200) : '';
        let line = `${idx + 1}. [${it.title}]${snippet ? `\n   摘要: ${snippet}` : ''}`;
        // Inject arc storyline context when available (only if arc has a summary)
        const arcInfo = options.itemArcMap?.get(it.id);
        if (arcInfo?.arcSummary) {
          const truncatedSummary = arcInfo.arcSummary.length > 50
            ? arcInfo.arcSummary.slice(0, 50) + '...'
            : arcInfo.arcSummary;
          line += `\n   该新闻属于故事线「${arcInfo.arcTitle}」（${truncatedSummary}），请据此生成 whyImportant`;
        }
        return line;
      })
      .join('\n');

    const prompt = `你是一位资深新闻编辑。请对以下 ${batch.length} 条新闻进行整理：

${itemList}

对每条新闻，请返回 JSON 数组，每个元素包含：
- id: 序号（从1开始）
- category: 分类名（中文，如"国际局势"、"科技"、"商业"、"中国"、"社会"、"开发者社区"等）
- categoryEmoji: 分类对应的 emoji（如 🌍、💻、💼、🇨🇳、📱、👨‍💻）
- chineseTitle: 中文标题（简洁有力，15字以内。英文新闻需翻译，中文新闻可微调）
- summary: 一句话中文摘要（30-50字，让读者快速理解核心内容）
${options.includeWhyImportant ? '- whyImportant: "为什么重要"（20-40字，解释这条新闻对读者的影响/意义，如无特别意义则为 null）' : '- whyImportant: null'}
- context: 背景信息（20-30字，帮读者理解来龙去脉，如新闻本身足够清晰则为 null）

注意：
1. 每条新闻根据其自身内容独立分类，不同新闻应有不同分类；分类要精确反映该条新闻的核心主题
2. 中文标题要吸引人但不标题党
3. 摘要要有信息增量，不要简单重复标题`;

    try {
      logger.info({ batchStart, batchSize: batch.length }, 'AI enhance batch starting');
      const result = await llm.json(prompt, enhanceResultSchema);

      if (result) {
        for (const item of result) {
          if (item.id >= 1 && item.id <= batch.length) {
            enhancedMap.set(batchStart + item.id - 1, {
              category: item.category,
              categoryEmoji: item.categoryEmoji,
              chineseTitle: item.chineseTitle,
              summary: item.summary,
              whyImportant: item.whyImportant ?? undefined,
              context: item.context ?? undefined,
            });
          }
        }
      }
    } catch (err) {
      logger.warn({ error: err, batchStart }, 'AI enhance batch failed');
    }
  }

  logger.info({ total: items.length, enhanced: enhancedMap.size }, 'AI enhance complete');

  return items.map((item, idx) => ({
    ...item,
    enhanced: enhancedMap.get(idx),
  }));
}
