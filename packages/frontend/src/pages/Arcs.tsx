import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { ArcStatus, ArcTitleSource, ArcTimelineEntry, StoryArc } from '@arclight/shared';
import { api, ApiError } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import BuzzBanner from '@/components/BuzzBanner';

type ArcFilterStatus = 'active' | 'stale' | 'all';

type ArcRecord = Omit<
  StoryArc,
  'firstSeen' | 'lastUpdated' | 'summaryUpdatedAt' | 'createdAt' | 'updatedAt'
> & {
  firstSeen: string | number | Date;
  lastUpdated: string | number | Date;
  summaryUpdatedAt?: string | number | Date | null;
  createdAt: string | number | Date;
  updatedAt: string | number | Date;
};

interface ArcListResponse {
  data: ArcRecord[];
  total?: number;
  pagination?: {
    total: number;
    limit: number;
    offset: number;
  };
}

const FILTER_OPTIONS: Array<{ value: ArcFilterStatus; label: string }> = [
  { value: 'active', label: '活跃' },
  { value: 'stale', label: '沉寂' },
  { value: 'all', label: '全部' },
];

const STATUS_META: Record<ArcStatus, { label: string; className: string }> = {
  active: {
    label: '活跃',
    className: 'bg-emerald-600 text-white hover:bg-emerald-600 dark:bg-emerald-500',
  },
  stale: {
    label: '沉寂',
    className: 'bg-amber-500 text-white hover:bg-amber-500 dark:bg-amber-500',
  },
  archived: {
    label: '已归档',
    className: 'bg-neutral-500 text-white hover:bg-neutral-500 dark:bg-neutral-600',
  },
};

const relativeFormatter = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });

function parseDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function formatRelativeTime(value: unknown): string {
  const date = parseDate(value);
  if (!date) return '-';

  const diffMs = date.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  if (absMs < 60_000) return '刚刚';

  const units: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
    { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
    { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
    { unit: 'day', ms: 24 * 60 * 60 * 1000 },
    { unit: 'hour', ms: 60 * 60 * 1000 },
    { unit: 'minute', ms: 60 * 1000 },
  ];

  const selected = units.find((candidate) => absMs >= candidate.ms) ?? units[units.length - 1];
  return relativeFormatter.format(Math.round(diffMs / selected.ms), selected.unit);
}

function getApiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const data = err.data;
    if (typeof data === 'object' && data !== null && 'error' in data) {
      const message = (data as { error?: unknown }).error;
      if (typeof message === 'string' && message) {
        return message;
      }
    }
  }

  if (err instanceof Error && err.message) {
    return err.message;
  }

  return fallback;
}

function getArcTotal(res: ArcListResponse): number {
  if (typeof res.total === 'number') return res.total;
  if (typeof res.pagination?.total === 'number') return res.pagination.total;
  return res.data.length;
}

function toArcFilterStatus(value: string): ArcFilterStatus {
  if (value === 'active' || value === 'stale' || value === 'all') return value;
  return 'active';
}

function formatBuzzScore(score: number): string {
  const normalized = Number(score);
  if (!Number.isFinite(normalized)) return '0';
  return Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(1);
}

const TITLE_SOURCE_META: Record<ArcTitleSource, { label: string; className: string }> = {
  llm: {
    label: 'AI',
    className: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
  },
  rule: {
    label: '规则',
    className: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
  },
  user: {
    label: '手动',
    className: 'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300',
  },
};

function truncateSummary(text: string, max = 80): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '…';
}

function getRecentHeadlines(timeline: ArcTimelineEntry[] | undefined | null, max = 3): string[] {
  if (!timeline || timeline.length === 0) return [];
  return [...timeline]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, max)
    .map((entry) => entry.headline)
    .filter(Boolean);
}

export default function Arcs() {
  const [status, setStatus] = useState<ArcFilterStatus>('active');
  const [arcs, setArcs] = useState<ArcRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api.get<ArcListResponse>(`/api/v1/arcs?status=${status}&limit=20&offset=0`)
      .then((res) => {
        if (cancelled) return;
        setArcs(res.data ?? []);
        setTotal(getArcTotal(res));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(getApiErrorMessage(err, '加载故事线失败，请稍后重试'));
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [status]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">故事线</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">追踪话题演进与关键节点</p>
      </div>

      <BuzzBanner />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={status} onValueChange={(value) => setStatus(toArcFilterStatus(value))}>
          <TabsList>
            {FILTER_OPTIONS.map((option) => (
              <TabsTrigger key={option.value} value={option.value}>
                {option.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <span className="text-sm text-neutral-500 dark:text-neutral-400">共 {total} 条故事线</span>
      </div>

      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Card key={index} className="gap-4 py-5">
              <CardHeader className="pb-0">
                <div className="h-5 w-2/3 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
                <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
              </CardHeader>
              <CardContent>
                <div className="h-4 w-3/4 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && arcs.length === 0 && (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-10 text-center text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
          当前筛选下暂无故事线
        </div>
      )}

      {!loading && !error && arcs.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {arcs.map((arc) => {
            const statusMeta = STATUS_META[arc.status];

            return (
              <Link key={arc.id} to={`/arcs/${arc.id}`} className="group block">
                <Card className="h-full gap-4 py-5 transition-colors group-hover:bg-neutral-50 dark:group-hover:bg-neutral-900/60">
                  <CardHeader className="pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <CardTitle className="text-base font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                          {arc.title}
                        </CardTitle>
                        {arc.titleSource && (
                          <Badge
                            variant="secondary"
                            className={`shrink-0 text-[10px] px-1.5 py-0 leading-4 ${TITLE_SOURCE_META[arc.titleSource]?.className ?? ''}`}
                          >
                            {TITLE_SOURCE_META[arc.titleSource]?.label ?? arc.titleSource}
                          </Badge>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Badge className={statusMeta.className}>{statusMeta.label}</Badge>
                        {arc.buzzScore > 0 && (
                          <Badge
                            variant="outline"
                            className="border-orange-300 text-orange-700 dark:border-orange-500/60 dark:text-orange-300"
                          >
                            🔥 {formatBuzzScore(arc.buzzScore)}
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {arc.entities.slice(0, 4).map((entity: string) => (
                        <Badge key={entity} variant="secondary">{entity}</Badge>
                      ))}
                      {arc.entities.length > 4 && (
                        <Badge variant="outline">+{arc.entities.length - 4}</Badge>
                      )}
                      {arc.entities.length === 0 && (
                        <span className="text-xs text-neutral-500 dark:text-neutral-400">暂无实体标签</span>
                      )}
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-2">
                    {arc.summary ? (
                      <p className="text-sm leading-5 text-neutral-600 dark:text-neutral-400 line-clamp-2">
                        {truncateSummary(arc.summary)}
                      </p>
                    ) : (
                      (() => {
                        const headlines = getRecentHeadlines(arc.timeline);
                        return headlines.length > 0 ? (
                          <ul className="space-y-0.5">
                            {headlines.map((hl, i) => (
                              <li key={i} className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                                <span className="text-neutral-400 dark:text-neutral-500 mr-1">·</span>
                                {hl}
                              </li>
                            ))}
                          </ul>
                        ) : null;
                      })()
                    )}
                    <p className="text-sm text-neutral-700 dark:text-neutral-300">
                      {arc.itemCount} items · {arc.sourceCount} sources
                    </p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      最近更新 {formatRelativeTime(arc.lastUpdated)}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
