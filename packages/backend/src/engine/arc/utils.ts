import { count, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { arcItems } from '../../db/schema.js';
import { feedItems } from '../../db/schema.js';

export async function getArcStats(arcId: string): Promise<{ itemCount: number; sourceCount: number }> {
  const stats = await db
    .select({
      itemCount: count(arcItems.id),
      sourceCount: sql<number>`count(distinct ${feedItems.sourceId})`,
    })
    .from(arcItems)
    .innerJoin(feedItems, eq(arcItems.itemId, feedItems.id))
    .where(eq(arcItems.arcId, arcId))
    .get();

  return {
    itemCount: Number(stats?.itemCount ?? 0),
    sourceCount: Number(stats?.sourceCount ?? 0),
  };
}

export function mergeTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const term of terms) {
    const value = term.trim().replace(/\s+/g, ' ');
    if (!value) continue;
    const key = /[a-zA-Z]/.test(value) ? value.toLowerCase() : value;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export function computeBuzzScore(itemCount: number, sourceCount: number): number {
  // Rule-based baseline used in Phase 1 before Buzz engine.
  return Number((sourceCount * 0.9 + Math.log2(itemCount + 1)).toFixed(3));
}
