import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../../db/client.js';
import { arcItems, storyArcs } from '../../db/schema.js';
import { logger } from '../../shared/logger.js';
import { getCandidatePool } from './candidate-pool.js';
import { extractEntities } from './entity-extractor.js';
import { getArcLLMQueue } from './llm-queue.js';
import { findBestMatch, getArcSnapshotCache } from './matcher.js';
import { getArcStats, mergeTerms, computeBuzzScore } from './utils.js';
import type { ArcProcessItem, CandidateGroup } from './types.js';

export async function processItemForArc(item: ArcProcessItem, userId: string): Promise<void> {
  const title = item.title?.trim();
  if (!title) return;

  const occurredAt = resolveOccurredAt(item);
  const extracted = extractEntities(title, item.content ?? '');
  const mergedEntities = mergeTerms([...(item.entities ?? []), ...extracted]);
  if (mergedEntities.length === 0) return;

  const match = await findBestMatch({
    userId,
    title,
    entities: mergedEntities,
    sourceId: item.sourceId,
    occurredAt,
  });

  if (match) {
    await addItemToArc(userId, match.arcId, item, mergedEntities, match.score, occurredAt);
    return;
  }

  const candidatePool = getCandidatePool();
  candidatePool.add(userId, {
    itemId: item.id,
    title,
    sourceId: item.sourceId,
    entities: mergedEntities,
    seenAt: occurredAt,
  });

  const readyGroup = candidatePool.takeReadyGroup(userId);
  if (readyGroup) {
    await createArcFromCandidateGroup(userId, readyGroup);
  }
}

async function addItemToArc(
  userId: string,
  arcId: string,
  item: ArcProcessItem,
  entities: string[],
  relevanceScore: number,
  occurredAt: number,
): Promise<void> {
  const existing = await db
    .select({ id: arcItems.id })
    .from(arcItems)
    .where(and(eq(arcItems.arcId, arcId), eq(arcItems.itemId, item.id)))
    .get();

  if (existing) return;

  await db.insert(arcItems).values({
    id: nanoid(),
    arcId,
    itemId: item.id,
    relevanceScore,
    isKeyEvent: relevanceScore >= 0.78 ? 1 : 0,
    headline: item.title || null,
    addedAt: new Date(occurredAt),
  });

  const arc = await db
    .select({
      id: storyArcs.id,
      userId: storyArcs.userId,
      title: storyArcs.title,
      entities: storyArcs.entities,
      keywords: storyArcs.keywords,
      timeline: storyArcs.timeline,
    })
    .from(storyArcs)
    .where(and(eq(storyArcs.id, arcId), eq(storyArcs.userId, userId)))
    .get();

  if (!arc) return;

  const stats = await getArcStats(arcId);
  const now = new Date();
  const nextEntities = mergeTerms([...(arc.entities ?? []), ...entities]);
  const nextKeywords = mergeTerms([...(arc.keywords ?? []), ...entities]).slice(0, 30);
  const nextTimeline = appendTimeline(arc.timeline ?? [], {
    date: dateKey(occurredAt),
    headline: item.title || '（无标题）',
    itemId: item.id,
  });

  await db
    .update(storyArcs)
    .set({
      entities: nextEntities,
      keywords: nextKeywords,
      timeline: nextTimeline,
      itemCount: stats.itemCount,
      sourceCount: stats.sourceCount,
      buzzScore: computeBuzzScore(stats.itemCount, stats.sourceCount),
      lastUpdated: new Date(occurredAt),
      status: 'active',
      updatedAt: now,
    })
    .where(eq(storyArcs.id, arcId));

  getArcSnapshotCache().upsert({
    id: arc.id,
    userId: arc.userId,
    title: arc.title,
    entities: nextEntities,
    keywords: nextKeywords,
    lastItemAt: occurredAt,
  });

  getArcLLMQueue().enqueue({
    type: 'summary_update',
    arcId,
  });
}

async function createArcFromCandidateGroup(userId: string, group: CandidateGroup): Promise<void> {
  const sortedItems = [...group.items].sort((a, b) => a.seenAt - b.seenAt);
  if (sortedItems.length < 2) return;

  const arcId = nanoid();
  const firstSeenAt = sortedItems[0].seenAt;
  const lastSeenAt = sortedItems[sortedItems.length - 1].seenAt;
  const entities = mergeTerms(
    group.sharedEntities.length > 0
      ? group.sharedEntities
      : sortedItems.flatMap((item) => item.entities),
  );
  const sourceCount = new Set(sortedItems.map((item) => item.sourceId)).size;
  const itemCount = sortedItems.length;
  const title = buildRuleTitle(entities, sortedItems);
  const now = new Date();

  await db.insert(storyArcs).values({
    id: arcId,
    userId,
    title,
    summary: null,
    tags: [],
    entities,
    keywords: entities.slice(0, 30),
    status: 'active',
    firstSeen: new Date(firstSeenAt),
    lastUpdated: new Date(lastSeenAt),
    itemCount,
    sourceCount,
    buzzScore: computeBuzzScore(itemCount, sourceCount),
    summaryUpdatedAt: null,
    titleSource: 'rule',
    mergedIntoId: null,
    timeline: sortedItems.map((candidate) => ({
      date: dateKey(candidate.seenAt),
      headline: candidate.title,
      itemId: candidate.itemId,
    })),
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(arcItems).values(
    sortedItems.map((candidate, index) => ({
      id: nanoid(),
      arcId,
      itemId: candidate.itemId,
      relevanceScore: 1,
      isKeyEvent: index === 0 || index === sortedItems.length - 1 ? 1 : 0,
      headline: candidate.title,
      addedAt: new Date(candidate.seenAt),
    })),
  );

  getArcSnapshotCache().upsert({
    id: arcId,
    userId,
    title,
    entities,
    keywords: entities.slice(0, 30),
    lastItemAt: lastSeenAt,
  });

  getArcLLMQueue().enqueue({
    type: 'title_generate',
    arcId,
  });
  getArcLLMQueue().enqueue({
    type: 'summary_update',
    arcId,
  });

  logger.info({ userId, arcId, itemCount, sourceCount, title }, 'New story arc created from candidate pool');
}

function buildRuleTitle(entities: string[], items: CandidateGroup['items']): string {
  if (entities.length > 0) {
    return `${entities[0]} 事件进展`;
  }

  const latest = items[items.length - 1]?.title || '新故事线';
  return latest.length > 32 ? `${latest.slice(0, 32)}...` : latest;
}

function appendTimeline(
  timeline: { date: string; headline: string; itemId: string }[],
  entry: { date: string; headline: string; itemId: string },
): { date: string; headline: string; itemId: string }[] {
  const next = [...timeline.filter((item) => item.itemId !== entry.itemId), entry];
  next.sort((a, b) => a.date.localeCompare(b.date));
  if (next.length > 50) return next.slice(next.length - 50);
  return next;
}

function resolveOccurredAt(item: ArcProcessItem): number {
  if (item.publishedAt) return new Date(item.publishedAt).getTime();
  if (item.fetchedAt) return new Date(item.fetchedAt).getTime();
  return Date.now();
}

function dateKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}
