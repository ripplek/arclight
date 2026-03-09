import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';

interface BuzzTopEntry {
  entity: string;
  maxScore: number;
  totalEvents: number;
  avgVelocity: number;
  maxSourceCount: number;
  arcId: string | null;
  arcTitle: string | null;
}

interface BuzzTopResponse {
  data: BuzzTopEntry[];
  meta?: {
    degraded?: boolean;
    reason?: string;
  };
}

function formatScore(score: number): string {
  const n = Number(score);
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export default function BuzzBanner() {
  const [entries, setEntries] = useState<BuzzTopEntry[]>([]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;

    api
      .get<BuzzTopResponse>('/api/v1/buzz/top?limit=3')
      .then((res) => {
        if (cancelled) return;

        // Hide when degraded (legacy schema)
        if (res.meta?.degraded) return;

        // Hide when no data
        if (!res.data || res.data.length === 0) return;

        setEntries(res.data);
        setVisible(true);
      })
      .catch(() => {
        // Silently degrade — don't break the Arcs page
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!visible) return null;

  return (
    <div className="rounded-lg border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 p-4 dark:border-orange-500/30 dark:from-orange-950/30 dark:to-amber-950/20">
      <h2 className="mb-3 text-sm font-semibold text-orange-800 dark:text-orange-300">
        🔥 热点事件
      </h2>

      <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
        {entries.map((entry) => {
          const content = (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {entry.entity}
              </span>
              <Badge
                variant="outline"
                className="border-orange-300 text-orange-700 dark:border-orange-500/60 dark:text-orange-300"
              >
                🔥 {formatScore(entry.maxScore)}
              </Badge>
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                {entry.maxSourceCount} 源
              </span>
            </div>
          );

          if (entry.arcId) {
            return (
              <Link
                key={entry.entity}
                to={`/arcs/${entry.arcId}`}
                className="group rounded-md px-2 py-1 transition-colors hover:bg-orange-100/60 dark:hover:bg-orange-900/30"
              >
                {content}
                {entry.arcTitle && (
                  <p className="mt-0.5 text-xs text-neutral-500 group-hover:text-orange-700 dark:text-neutral-400 dark:group-hover:text-orange-300">
                    → {entry.arcTitle}
                  </p>
                )}
              </Link>
            );
          }

          return (
            <div key={entry.entity} className="px-2 py-1">
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
