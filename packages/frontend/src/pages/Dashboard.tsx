import { useState, useEffect } from 'react';
import { Link } from 'react-router';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface DigestDetail {
  id: string;
  tier: string;
  date: string;
  contentHtml: string | null;
  contentMarkdown: string | null;
  metadata?: {
    itemCount: number;
    generatedAt: string;
  };
}

interface Stats {
  totalItems: number;
  totalSources: number;
  enabledSources: number;
  errorSources: number;
}

export default function Dashboard() {
  const [latestDigest, setLatestDigest] = useState<DigestDetail | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    // Load latest digest (ignore 404)
    api.get<DigestDetail>('/api/v1/me/digests/latest?tier=daily')
      .then(setLatestDigest)
      .catch(() => { /* no digest yet */ });

    // Load stats (may fail if not admin)
    api.get<{ data: Stats }>('/api/v1/engine/stats')
      .then((res) => setStats(res.data))
      .catch(() => { /* not admin */ });
  }, []);

  async function generateDaily() {
    setGenerating(true);
    try {
      const digest = await api.post<DigestDetail>('/api/v1/me/digests/generate', { tier: 'daily' });
      setLatestDigest(digest);
    } catch (err) {
      console.error('Generate failed:', err);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
        Dashboard
      </h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400">
        欢迎使用 ArcLight — 你的智能信息助手
      </p>

      <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-neutral-500">信源数量</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats?.totalSources ?? '—'}</p>
            {stats && (
              <p className="text-sm text-neutral-500 mt-1">
                {stats.enabledSources} 启用 · {stats.errorSources} 异常
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-neutral-500">总文章数</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats?.totalItems ?? '—'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-neutral-500">最新 Digest</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              {latestDigest ? latestDigest.metadata?.itemCount ?? 0 : '—'}
            </p>
            {latestDigest && (
              <p className="text-sm text-neutral-500 mt-1">{latestDigest.date}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-8 rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">📰 最新摘要</h2>
          <div className="flex gap-2">
            {latestDigest && (
              <Link to={`/digests/${latestDigest.id}`}>
                <Button variant="outline" size="sm">查看全文</Button>
              </Link>
            )}
            <Button variant="outline" size="sm" disabled={generating} onClick={generateDaily}>
              {generating ? '生成中...' : '生成 Daily'}
            </Button>
          </div>
        </div>

        {latestDigest ? (
          <div>
            {latestDigest.contentHtml ? (
              <div
                className="prose prose-neutral dark:prose-invert max-w-none prose-sm"
                dangerouslySetInnerHTML={{
                  __html: latestDigest.contentHtml.slice(0, 2000) +
                    (latestDigest.contentHtml.length > 2000 ? '...' : ''),
                }}
              />
            ) : latestDigest.contentMarkdown ? (
              <pre className="whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">
                {latestDigest.contentMarkdown.slice(0, 1000)}
                {latestDigest.contentMarkdown.length > 1000 ? '...' : ''}
              </pre>
            ) : (
              <p className="text-neutral-500">暂无内容</p>
            )}
          </div>
        ) : (
          <p className="text-neutral-500">
            暂无摘要，点击"生成 Daily"开始。
          </p>
        )}
      </div>
    </div>
  );
}
