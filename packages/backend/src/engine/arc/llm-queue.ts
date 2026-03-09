import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { storyArcs } from '../../db/schema.js';
import { getLLMClient } from '../llm/client.js';
import { logger } from '../../shared/logger.js';
import { getArcSnapshotCache } from './matcher.js';

const PROCESS_INTERVAL_MS = 30_000;
const BATCH_SIZE = 5;
const SUMMARY_UPDATE_MIN_INTERVAL_MS = 2 * 60 * 60 * 1000;

export type ArcLLMTaskType = 'title_generate' | 'summary_update' | 'entity_enhance';

export interface ArcLLMTask {
  type: ArcLLMTaskType;
  arcId: string;
}

export class ArcLLMQueue {
  private queue: ArcLLMTask[] = [];
  private pendingKeys = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private processing = false;

  start(): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      this.processBatch().catch((error) => {
        logger.warn({ error }, 'Arc LLM queue batch processing failed');
      });
    }, PROCESS_INTERVAL_MS);

    logger.info({ intervalMs: PROCESS_INTERVAL_MS, batchSize: BATCH_SIZE }, 'Arc LLM queue started');
    this.processBatch().catch((error) => {
      logger.warn({ error }, 'Arc LLM queue initial batch failed');
    });
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    logger.info('Arc LLM queue stopped');
  }

  enqueue(task: ArcLLMTask): void {
    if (!task.arcId) return;

    const key = this.taskKey(task);
    if (this.pendingKeys.has(key)) return;

    this.queue.push(task);
    this.pendingKeys.add(key);
  }

  private taskKey(task: ArcLLMTask): string {
    return `${task.type}:${task.arcId}`;
  }

  private async processBatch(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    const llm = getLLMClient();
    if (!llm.isEnabled) return; // Leave tasks in queue — retry when LLM becomes available

    this.processing = true;
    const batch = this.queue.splice(0, BATCH_SIZE);

    try {

      for (const task of batch) {
        try {
          await this.processTask(task);
        } catch {
          // Graceful degradation: never block the queue if one task fails.
        }
      }
    } finally {
      for (const task of batch) {
        this.pendingKeys.delete(this.taskKey(task));
      }
      this.processing = false;
    }
  }

  private async processTask(task: ArcLLMTask): Promise<void> {
    switch (task.type) {
      case 'title_generate':
        await this.handleTitleGenerate(task.arcId);
        return;
      case 'summary_update':
        await this.handleSummaryUpdate(task.arcId);
        return;
      case 'entity_enhance':
        return;
      default:
        return;
    }
  }

  private async handleTitleGenerate(arcId: string): Promise<void> {
    const llm = getLLMClient();
    if (!llm.isEnabled) return;

    const arc = await db
      .select({
        id: storyArcs.id,
        userId: storyArcs.userId,
        title: storyArcs.title,
        titleSource: storyArcs.titleSource,
        entities: storyArcs.entities,
        keywords: storyArcs.keywords,
        timeline: storyArcs.timeline,
        lastUpdated: storyArcs.lastUpdated,
      })
      .from(storyArcs)
      .where(eq(storyArcs.id, arcId))
      .get();

    if (!arc || arc.titleSource === 'user' || arc.titleSource === 'llm') return;

    const headlines = Array.from(
      new Set(
        (arc.timeline ?? [])
          .map((entry) => entry.headline?.trim())
          .filter((headline): headline is string => Boolean(headline)),
      ),
    ).slice(0, 20);

    if (headlines.length === 0) return;

    const entities = (arc.entities ?? []).filter((entity) => entity.trim().length > 0).slice(0, 20);
    const titleList = headlines.map((headline, index) => `${index + 1}. ${headline}`).join('\n');
    const entityList = entities.length > 0 ? entities.join('、') : '无';

    const prompt = `你是一位资深新闻编辑。以下是一组相关新闻的标题：
${titleList}
共享的关键实体：${entityList}
请为这组新闻生成一个简洁的"故事线标题"：
1. 10-20 个中文字
2. 概括整个事件的主题
3. 用中文
4. 不要标点符号
只返回标题文字。`;

    const generated = await llm.text(prompt, '你是严谨的中文新闻编辑，只输出标题文字。');
    const nextTitle = normalizeGeneratedTitle(generated);
    if (!nextTitle) return;

    const updated = await db
      .update(storyArcs)
      .set({
        title: nextTitle,
        titleSource: 'llm',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(storyArcs.id, arc.id),
          eq(storyArcs.userId, arc.userId),
          eq(storyArcs.titleSource, 'rule'),
        ),
      );

    const changes = Number((updated as { changes?: number }).changes ?? 0);
    if (changes === 0) return;

    getArcSnapshotCache().upsert({
      id: arc.id,
      userId: arc.userId,
      title: nextTitle,
      entities: arc.entities ?? [],
      keywords: arc.keywords ?? [],
      lastItemAt: new Date(arc.lastUpdated).getTime(),
    });
  }

  private async handleSummaryUpdate(arcId: string): Promise<void> {
    const llm = getLLMClient();
    if (!llm.isEnabled) return;

    const arc = await db
      .select({
        id: storyArcs.id,
        title: storyArcs.title,
        entities: storyArcs.entities,
        timeline: storyArcs.timeline,
        summary: storyArcs.summary,
        summaryUpdatedAt: storyArcs.summaryUpdatedAt,
      })
      .from(storyArcs)
      .where(eq(storyArcs.id, arcId))
      .get();

    if (!arc) return;

    const now = new Date();
    const summaryUpdatedAt = arc.summaryUpdatedAt ? new Date(arc.summaryUpdatedAt) : null;
    if (summaryUpdatedAt && now.getTime() - summaryUpdatedAt.getTime() < SUMMARY_UPDATE_MIN_INTERVAL_MS) {
      return;
    }

    const timelineLines = (arc.timeline ?? [])
      .filter((entry) => entry.headline?.trim())
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-10)
      .map((entry) => `${entry.date}: ${entry.headline.trim()}`);
    const timelineText = timelineLines.length > 0 ? timelineLines.join('\n') : '暂无有效事件';
    const entities = (arc.entities ?? []).map((value) => value.trim()).filter((value) => value.length > 0).slice(0, 20);
    const entityText = entities.length > 0 ? entities.join('、') : '无';

    const prompt = `你是一位新闻编辑。以下是一条新闻故事线的时间线：
标题：${arc.title}
关键实体：${entityText}
时间线（按时间排序）：
${timelineText}
请生成 100-150 字的中文摘要：
1. 按时间顺序梳理事件发展脉络
2. 突出关键转折点
3. 最后一句总结当前状态或展望
4. 不要使用标题格式或 markdown
只返回摘要文字。`;

    const generated = await llm.text(prompt, '你是严谨的中文新闻编辑，只输出摘要正文。');
    const nextSummary = normalizeGeneratedSummary(generated);
    if (!nextSummary) return;

    await db
      .update(storyArcs)
      .set({
        summary: nextSummary,
        summaryUpdatedAt: now,
        updatedAt: now,
      })
      .where(eq(storyArcs.id, arc.id));

    logger.info({ arcId: arc.id, summaryLength: nextSummary.length }, 'Arc summary updated');
  }
}

function normalizeGeneratedTitle(value: string): string {
  if (!value) return '';
  const withoutCodeFence = value
    .replace(/```(?:text|markdown)?/gi, '')
    .replace(/```/g, '');

  const firstLine = withoutCodeFence
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? '';

  if (!firstLine) return '';

  const normalized = firstLine
    .replace(/^["'“”‘’《》「」【】\[\]]+|["'“”‘’《》「」【】\[\]]+$/g, '')
    .replace(/^[\s\d\-*.、。:：]+/, '')
    .replace(/[\p{P}\p{S}]+/gu, '')
    .replace(/\s+/g, '')
    .trim();

  if (normalized.length < 4) return '';
  return normalized.slice(0, 20);
}

function normalizeGeneratedSummary(value: string): string {
  if (!value) return '';

  const normalized = value
    .replace(/```[\w-]*\n?/g, '')
    .replace(/```/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/[*_~`>#]/g, '')
    .replace(/^(摘要|概述|总结)\s*[:：]\s*/i, '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”‘’《》「」【】\[\]()]+|["'“”‘’《》「」【】\[\]()]+$/g, '')
    .trim();

  if (normalized.length < 50) return '';
  return normalized.slice(0, 300).trim();
}

let queueInstance: ArcLLMQueue | null = null;

export function getArcLLMQueue(): ArcLLMQueue {
  if (!queueInstance) {
    queueInstance = new ArcLLMQueue();
  }
  return queueInstance;
}
