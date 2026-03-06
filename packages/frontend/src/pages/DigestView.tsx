import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';

interface DigestDetail {
  id: string;
  tier: string;
  date: string;
  contentMarkdown: string | null;
  contentHtml: string | null;
  itemIds: string[];
  metadata?: {
    itemCount: number;
    generatedAt: string;
    pipelineDurationMs?: number;
  };
}

const TIER_ICONS: Record<string, string> = {
  flash: '⚡',
  daily: '📰',
  deep: '🔍',
};

export default function DigestView() {
  const { id } = useParams();
  const [digest, setDigest] = useState<DigestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.get<DigestDetail>(`/api/v1/me/digests/${id}`)
      .then(setDigest)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-4">Loading...</div>;
  if (error) return <div className="p-4 text-red-500">Error: {error}</div>;
  if (!digest) return <div className="p-4">Not found</div>;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/digests">
            <Button variant="ghost" size="sm">← 返回列表</Button>
          </Link>
        </div>
        <div className="text-sm text-neutral-500">
          {digest.metadata?.itemCount ?? 0} 条 ·
          {digest.metadata?.pipelineDurationMs
            ? ` ${digest.metadata.pipelineDurationMs}ms`
            : ''}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-3xl">{TIER_ICONS[digest.tier] || '📰'}</span>
        <h1 className="text-2xl font-bold">{digest.date}</h1>
      </div>

      {/* Render HTML content or fallback to markdown */}
      {digest.contentHtml ? (
        <div
          className="prose prose-neutral dark:prose-invert max-w-none"
          dangerouslySetInnerHTML={{ __html: digest.contentHtml }}
        />
      ) : digest.contentMarkdown ? (
        <div className="whitespace-pre-wrap font-mono text-sm bg-neutral-50 dark:bg-neutral-900 p-4 rounded-lg border">
          {digest.contentMarkdown}
        </div>
      ) : (
        <p className="text-neutral-500">No content available</p>
      )}
    </div>
  );
}
