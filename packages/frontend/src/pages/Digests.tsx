import { useState, useEffect } from 'react';
import { Link } from 'react-router';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface DigestSummary {
  id: string;
  tier: string;
  date: string;
  createdAt: string;
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
  weekly: '📅',
  buzz: '🔥',
  alert: '🚨',
};

const TIER_LABELS: Record<string, string> = {
  flash: 'Flash',
  daily: 'Daily',
  deep: 'Deep',
  weekly: 'Weekly',
  buzz: 'Buzz',
  alert: 'Alert',
};

export default function Digests() {
  const [digestList, setDigestList] = useState<DigestSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);

  useEffect(() => {
    loadDigests();
  }, []);

  async function loadDigests() {
    try {
      const res = await api.get<{ digests: DigestSummary[] }>('/api/v1/me/digests');
      setDigestList(res.digests);
    } finally {
      setLoading(false);
    }
  }

  async function generate(tier: 'flash' | 'daily' | 'deep') {
    setGenerating(tier);
    try {
      await api.post('/api/v1/me/digests/generate', { tier });
      await loadDigests();
    } finally {
      setGenerating(null);
    }
  }

  if (loading) return <div className="p-4">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Digests</h1>
        <div className="flex gap-2">
          {(['flash', 'daily', 'deep'] as const).map((tier) => (
            <Button
              key={tier}
              variant="outline"
              size="sm"
              disabled={generating !== null}
              onClick={() => generate(tier)}
            >
              {generating === tier ? '生成中...' : `${TIER_ICONS[tier]} 生成 ${TIER_LABELS[tier]}`}
            </Button>
          ))}
        </div>
      </div>

      {digestList.length === 0 && (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-neutral-500">暂无 Digest，点击上方按钮生成一个。</p>
        </div>
      )}

      <div className="space-y-3">
        {digestList.map((digest) => (
          <Link key={digest.id} to={`/digests/${digest.id}`}>
            <Card className="transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/50 cursor-pointer">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <span>{TIER_ICONS[digest.tier] || '📰'}</span>
                    <span>{TIER_LABELS[digest.tier] || digest.tier}</span>
                    <span className="text-neutral-400 font-normal">— {digest.date}</span>
                  </CardTitle>
                  <span className="text-sm text-neutral-400">
                    {digest.metadata?.itemCount ?? 0} 条
                  </span>
                </div>
              </CardHeader>
              <CardContent className="pb-3">
                <p className="text-sm text-neutral-500">
                  生成于 {new Date(digest.metadata?.generatedAt || digest.createdAt).toLocaleString('zh-CN')}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
