/**
 * BuzzDetector — Sprint 2 C1
 *
 * Scans recent items for entity co-occurrence across multiple sources,
 * scores the resulting "buzz events", merges overlapping ones, persists
 * to the buzzEvents table, and back-fills buzzScore on matching active Arcs.
 *
 * Design constraints:
 *  - No new dependencies
 *  - Safe degradation on legacy schema (schema-compat check)
 *  - Exceptions caught + warned — never breaks the caller
 */

import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../../db/client.js';
import { buzzEvents, feedItems, storyArcs } from '../../db/schema.js';
import { hasRequiredColumns } from '../digest/schema-compat.js';
import { logger } from '../../shared/logger.js';

// ── tunables ───────────────────────────────────────────────────────────
const BUZZ_WINDOW_HOURS = 6;
const MIN_SOURCES = 3;
const MIN_ITEMS = 3;
const MERGE_OVERLAP_THRESHOLD = 0.5;

// ── types ──────────────────────────────────────────────────────────────

interface EntityIndex {
  entity: string;
  items: {
    itemId: string;
    sourceId: string;
    fetchedAt: number;
  }[];
}

interface RawBuzz {
  entity: string;
  itemIds: Set<string>;
  sourceIds: Set<string>;
  score: number;
  velocity: number;
}

interface BuzzResult {
  entity: string;
  itemIds: string[];
  sourceCount: number;
  itemCount: number;
  score: number;
  velocity: number;
}

// ── BuzzDetector ───────────────────────────────────────────────────────

export class BuzzDetector {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  /**
   * Main entry — run a full buzz detection cycle for this user.
   * Returns the persisted buzz results (may be empty).
   */
  async detect(): Promise<BuzzResult[]> {
    try {
      // Schema guard — bail gracefully on legacy DBs
      if (!this.checkSchema()) {
        logger.warn('BuzzDetector: buzzEvents table missing required columns — skipping');
        return [];
      }

      const invertedIndex = await this.buildEntityIndex();
      if (invertedIndex.length === 0) return [];

      const rawBuzzes = this.scoreBuzzes(invertedIndex);
      if (rawBuzzes.length === 0) return [];

      const merged = this.mergeSimilar(rawBuzzes);
      const results = merged.map((b) => ({
        entity: b.entity,
        itemIds: [...b.itemIds],
        sourceCount: b.sourceIds.size,
        itemCount: b.itemIds.size,
        score: b.score,
        velocity: b.velocity,
      }));

      await this.persist(results);
      await this.updateArcs(results);

      logger.info(
        { userId: this.userId, buzzCount: results.length },
        'BuzzDetector: cycle complete',
      );
      return results;
    } catch (err) {
      logger.warn({ err, userId: this.userId }, 'BuzzDetector: detection failed — skipping');
      return [];
    }
  }

  // ── 1. schema guard ────────────────────────────────────────────────

  private checkSchema(): boolean {
    const buzzOk = hasRequiredColumns('buzz_events', [
      'id', 'user_id', 'entity', 'item_id', 'score', 'velocity',
      'source_count', 'event_at', 'created_at',
    ]);
    return buzzOk;
  }

  // ── 2. build entity → items inverted index ────────────────────────

  private async buildEntityIndex(): Promise<EntityIndex[]> {
    const cutoff = new Date(Date.now() - BUZZ_WINDOW_HOURS * 60 * 60 * 1000);

    const rows = await db
      .select({
        id: feedItems.id,
        sourceId: feedItems.sourceId,
        entities: feedItems.entities,
        fetchedAt: feedItems.fetchedAt,
      })
      .from(feedItems)
      .where(gte(feedItems.fetchedAt, cutoff))
      .all();

    const map = new Map<string, EntityIndex['items']>();

    for (const row of rows) {
      const entities: string[] = row.entities ?? [];
      if (entities.length === 0) continue;

      const fetchedAt = row.fetchedAt
        ? new Date(row.fetchedAt as unknown as string | number).getTime()
        : Date.now();

      for (const raw of entities) {
        const entity = normalizeEntity(raw);
        if (!entity) continue;

        let bucket = map.get(entity);
        if (!bucket) {
          bucket = [];
          map.set(entity, bucket);
        }
        bucket.push({ itemId: row.id, sourceId: row.sourceId, fetchedAt });
      }
    }

    return [...map.entries()].map(([entity, items]) => ({ entity, items }));
  }

  // ── 3. score ───────────────────────────────────────────────────────

  private scoreBuzzes(index: EntityIndex[]): RawBuzz[] {
    const results: RawBuzz[] = [];

    for (const entry of index) {
      const uniqueSources = new Set(entry.items.map((i) => i.sourceId));
      const uniqueItems = new Set(entry.items.map((i) => i.itemId));

      if (uniqueSources.size < MIN_SOURCES) continue;
      if (uniqueItems.size < MIN_ITEMS) continue;

      const itemCount = uniqueItems.size;
      const sourceCount = uniqueSources.size;
      const velocity = itemCount / BUZZ_WINDOW_HOURS;
      const score = Number(
        (sourceCount * Math.log2(itemCount + 1) * (1 + velocity)).toFixed(3),
      );

      results.push({
        entity: entry.entity,
        itemIds: uniqueItems,
        sourceIds: uniqueSources,
        score,
        velocity,
      });
    }

    // highest score first
    results.sort((a, b) => b.score - a.score);
    return results;
  }

  // ── 4. merge similar buzzes ────────────────────────────────────────

  private mergeSimilar(buzzes: RawBuzz[]): RawBuzz[] {
    if (buzzes.length <= 1) return buzzes;

    const merged: RawBuzz[] = [];
    const absorbed = new Set<number>();

    for (let i = 0; i < buzzes.length; i++) {
      if (absorbed.has(i)) continue;

      const primary = { ...buzzes[i], itemIds: new Set(buzzes[i].itemIds), sourceIds: new Set(buzzes[i].sourceIds) };

      for (let j = i + 1; j < buzzes.length; j++) {
        if (absorbed.has(j)) continue;

        const overlap = setOverlap(primary.itemIds, buzzes[j].itemIds);
        const minSize = Math.min(primary.itemIds.size, buzzes[j].itemIds.size);

        if (minSize > 0 && overlap / minSize > MERGE_OVERLAP_THRESHOLD) {
          // absorb j into primary
          for (const id of buzzes[j].itemIds) primary.itemIds.add(id);
          for (const id of buzzes[j].sourceIds) primary.sourceIds.add(id);
          // keep best score & entity
          if (buzzes[j].score > primary.score) {
            primary.score = buzzes[j].score;
            primary.entity = buzzes[j].entity;
            primary.velocity = buzzes[j].velocity;
          }
          absorbed.add(j);
        }
      }

      merged.push(primary);
    }

    return merged;
  }

  // ── 5. persist to buzzEvents ───────────────────────────────────────

  private async persist(results: BuzzResult[]): Promise<void> {
    if (results.length === 0) return;

    const now = new Date();
    const rows = results.flatMap((buzz) =>
      buzz.itemIds.map((itemId) => ({
        id: nanoid(),
        userId: this.userId,
        arcId: null as string | null,
        itemId,
        sourceId: null as string | null,
        entity: buzz.entity,
        score: buzz.score,
        velocity: buzz.velocity,
        sourceCount: buzz.sourceCount,
        eventAt: now,
        createdAt: now,
      })),
    );

    // batch insert in chunks (SQLite variable limit ≈ 999)
    const CHUNK = 50;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      await db.insert(buzzEvents).values(chunk);
    }
  }

  // ── 6. update matching active arcs ─────────────────────────────────

  private async updateArcs(results: BuzzResult[]): Promise<void> {
    if (results.length === 0) return;

    // Collect all buzz entities
    const buzzEntities = results.map((r) => r.entity);

    // Check if storyArcs table has buzzScore column
    if (!hasRequiredColumns('story_arcs', ['buzz_score', 'entities', 'status'])) {
      logger.warn('BuzzDetector: storyArcs table missing required columns — skip arc update');
      return;
    }

    // Fetch active arcs for this user
    const activeArcs = await db
      .select({
        id: storyArcs.id,
        entities: storyArcs.entities,
        buzzScore: storyArcs.buzzScore,
      })
      .from(storyArcs)
      .where(
        and(
          eq(storyArcs.userId, this.userId),
          eq(storyArcs.status, 'active'),
        ),
      )
      .all();

    for (const arc of activeArcs) {
      const arcEntities = (arc.entities ?? []).map(normalizeEntity).filter(Boolean) as string[];
      if (arcEntities.length === 0) continue;

      // Find best matching buzz for this arc
      let bestScore = 0;
      for (const buzz of results) {
        const buzzNorm = normalizeEntity(buzz.entity);
        if (buzzNorm && arcEntities.includes(buzzNorm)) {
          if (buzz.score > bestScore) bestScore = buzz.score;
        }
      }

      if (bestScore > 0) {
        // Update arc buzzScore — take the higher of existing and new
        const currentScore = arc.buzzScore ?? 0;
        const newScore = Math.max(currentScore, bestScore);

        await db
          .update(storyArcs)
          .set({
            buzzScore: newScore,
            updatedAt: new Date(),
          })
          .where(eq(storyArcs.id, arc.id));

        // Also back-fill arcId on matching buzzEvents rows
        await db
          .update(buzzEvents)
          .set({ arcId: arc.id })
          .where(
            and(
              eq(buzzEvents.userId, this.userId),
              eq(buzzEvents.arcId, sql`NULL`),
              inArray(
                buzzEvents.entity,
                buzzEntities.filter((e) => {
                  const n = normalizeEntity(e);
                  return n && arcEntities.includes(n);
                }),
              ),
            ),
          );

        logger.info(
          { arcId: arc.id, buzzScore: newScore },
          'BuzzDetector: updated arc buzzScore',
        );
      }
    }
  }
}

// ── helpers ────────────────────────────────────────────────────────────

function normalizeEntity(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  return /[a-zA-Z]/.test(trimmed) ? trimmed.toLowerCase() : trimmed;
}

function setOverlap<T>(a: Set<T>, b: Set<T>): number {
  let count = 0;
  for (const item of a) {
    if (b.has(item)) count++;
  }
  return count;
}
