import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { ArcStatus, StoryArc } from '@arclight/shared';
import { api, ApiError } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

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

interface ArcItem {
  arcItemId: string;
  itemId: string;
  title: string | null;
  headline: string | null;
  url: string;
  sourceId: string;
  sourceName: string;
  publishedAt: string | number | Date | null;
  fetchedAt: string | number | Date | null;
  addedAt: string | number | Date;
  relevanceScore: number;
  isKeyEvent: number;
}

interface ArcDetailResponse {
  data: {
    arc: ArcRecord;
    items: ArcItem[];
  };
}

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

function formatDateTime(value: unknown): string {
  const date = parseDate(value);
  if (!date) return '-';
  return date.toLocaleString('zh-CN', { hour12: false });
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

function getTimelineTimestamp(item: ArcItem): number {
  const date = parseDate(item.publishedAt) ?? parseDate(item.addedAt) ?? parseDate(item.fetchedAt);
  return date ? date.getTime() : 0;
}

function getTimelineDateLabel(item: ArcItem): string {
  return formatDateTime(parseDate(item.publishedAt) ?? parseDate(item.addedAt) ?? parseDate(item.fetchedAt));
}

function getTimelineHeadline(item: ArcItem): string {
  const headline = item.headline?.trim();
  if (headline) return headline;

  const title = item.title?.trim();
  if (title) return title;

  return '（无标题）';
}

function formatBuzzScore(score: number): string {
  const normalized = Number(score);
  if (!Number.isFinite(normalized)) return '0';
  return Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(1);
}

export default function ArcDetail() {
  const { id } = useParams();
  const [arc, setArc] = useState<ArcRecord | null>(null);
  const [items, setItems] = useState<ArcItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setError('缺少故事线 ID');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    api.get<ArcDetailResponse>(`/api/v1/arcs/${id}`)
      .then((res) => {
        if (cancelled) return;
        setArc(res.data.arc);
        setItems(res.data.items ?? []);
        setTitleInput(res.data.arc.title);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(getApiErrorMessage(err, '加载故事线详情失败，请稍后重试'));
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  const timelineItems = useMemo(() => {
    return [...items].sort((a, b) => getTimelineTimestamp(a) - getTimelineTimestamp(b));
  }, [items]);

  async function saveTitle() {
    if (!id || !arc) return;

    const nextTitle = titleInput.trim();
    if (!nextTitle) {
      setTitleError('标题不能为空');
      return;
    }

    if (nextTitle === arc.title) {
      setEditingTitle(false);
      setTitleError(null);
      return;
    }

    setSavingTitle(true);
    setTitleError(null);

    try {
      await api.patch(`/api/v1/arcs/${id}`, { title: nextTitle });
      setArc((prev) => (prev ? { ...prev, title: nextTitle, titleSource: 'user' } : prev));
      setEditingTitle(false);
    } catch (err) {
      setTitleError(getApiErrorMessage(err, '更新标题失败，请稍后重试'));
    } finally {
      setSavingTitle(false);
    }
  }

  function cancelEditTitle() {
    setEditingTitle(false);
    setTitleError(null);
    setTitleInput(arc?.title ?? '');
  }

  if (loading) {
    return <div className="p-4 text-neutral-500 dark:text-neutral-400">加载中...</div>;
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Link to="/arcs">
          <Button variant="ghost" size="sm">← 返回故事线列表</Button>
        </Link>
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      </div>
    );
  }

  if (!arc) {
    return <div className="p-4 text-neutral-500 dark:text-neutral-400">故事线不存在</div>;
  }

  const statusMeta = STATUS_META[arc.status];

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <Link to="/arcs">
          <Button variant="ghost" size="sm">← 返回故事线列表</Button>
        </Link>

        <div className="space-y-3">
          {editingTitle ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                value={titleInput}
                onChange={(event) => setTitleInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void saveTitle();
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    cancelEditTitle();
                  }
                }}
                autoFocus
              />
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => void saveTitle()} disabled={savingTitle}>
                  {savingTitle ? '保存中...' : '保存'}
                </Button>
                <Button size="sm" variant="outline" onClick={cancelEditTitle} disabled={savingTitle}>
                  取消
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditingTitle(true)}
              className="w-full text-left"
              aria-label="编辑故事线标题"
            >
              <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{arc.title}</h1>
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">点击标题可编辑</p>
            </button>
          )}

          {titleError && (
            <p className="text-sm text-destructive">{titleError}</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Badge className={statusMeta.className}>{statusMeta.label}</Badge>
            {arc.entities.map((entity: string) => (
              <Badge key={entity} variant="secondary">{entity}</Badge>
            ))}
            {arc.entities.length === 0 && (
              <span className="text-sm text-neutral-500 dark:text-neutral-400">暂无实体标签</span>
            )}
          </div>
        </div>
      </div>

      {arc.summary && (
        <Card className="gap-3 py-5">
          <CardHeader className="pb-0">
            <CardTitle className="text-base">摘要</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-6 text-neutral-700 dark:text-neutral-300">{arc.summary}</p>
          </CardContent>
        </Card>
      )}

      <Card className="gap-3 py-5">
        <CardHeader className="pb-0">
          <CardTitle className="text-base">统计</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">文章数</p>
            <p className="mt-1 text-lg font-semibold">{arc.itemCount}</p>
          </div>
          <div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">信源数</p>
            <p className="mt-1 text-lg font-semibold">{arc.sourceCount}</p>
          </div>
          <div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">热度</p>
            <p className="mt-1 text-lg font-semibold">🔥 {formatBuzzScore(arc.buzzScore)}</p>
          </div>
          <div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">首次出现</p>
            <p className="mt-1 text-sm font-medium">{formatDateTime(arc.firstSeen)}</p>
          </div>
          <div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">最近更新</p>
            <p className="mt-1 text-sm font-medium">{formatDateTime(arc.lastUpdated)}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-4 py-5">
        <CardHeader className="pb-0">
          <CardTitle className="text-base">时间线</CardTitle>
        </CardHeader>
        <CardContent>
          {timelineItems.length === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">暂无相关事件</p>
          ) : (
            <div className="space-y-0">
              {timelineItems.map((item, index) => {
                const isKeyEvent = Number(item.isKeyEvent) === 1;
                return (
                  <div key={item.arcItemId} className="relative pl-6 pb-5 last:pb-0">
                    <span
                      className={cn(
                        'absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-neutral-400 dark:bg-neutral-500',
                        isKeyEvent && 'h-3 w-3 bg-amber-500 ring-2 ring-amber-500/20 dark:ring-amber-400/40',
                      )}
                    />
                    {index < timelineItems.length - 1 && (
                      <span className="absolute left-[4px] top-4 h-[calc(100%-0.5rem)] w-px bg-neutral-200 dark:bg-neutral-700" />
                    )}

                    <div
                      className={cn(
                        'rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900',
                        isKeyEvent && 'border-amber-300 bg-amber-50/40 dark:border-amber-500/50 dark:bg-amber-500/10',
                      )}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-xs text-neutral-500 dark:text-neutral-400">{getTimelineDateLabel(item)}</p>
                          <p className="mt-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">
                            {getTimelineHeadline(item)}
                          </p>
                        </div>
                        {isKeyEvent && (
                          <Badge className="bg-amber-500 text-white hover:bg-amber-500 dark:bg-amber-500">
                            关键事件
                          </Badge>
                        )}
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                        <Badge variant="outline">{item.sourceName || '未知来源'}</Badge>
                        {item.url && (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sky-600 hover:underline dark:text-sky-400"
                          >
                            阅读原文
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
