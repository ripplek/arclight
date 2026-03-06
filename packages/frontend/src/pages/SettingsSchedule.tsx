import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface ScheduleItem {
  enabled: boolean;
  time: string;
  count: number;
}

interface Schedule {
  flash?: ScheduleItem;
  daily?: ScheduleItem;
  deep?: ScheduleItem;
}

const TIER_INFO = {
  flash: { emoji: '⚡', name: 'Flash', desc: '速览标题，60 秒掌握全局', defaultCount: 8 },
  daily: { emoji: '📰', name: 'Daily', desc: '今日精选，标题+背景', defaultCount: 8 },
  deep:  { emoji: '🔍', name: 'Deep',  desc: '深度推荐，含长摘要', defaultCount: 2 },
} as const;

export default function SettingsSchedule() {
  const [schedule, setSchedule] = useState<Schedule>({});
  const [loading, setLoading] = useState(true);
  const [_saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<{ data: { schedule: Schedule } }>('/api/v1/me/preferences').then((res) => {
      setSchedule(res.data.schedule || {});
      setLoading(false);
    });
  }, []);

  async function save(newSchedule: Schedule) {
    setSaving(true);
    try {
      await api.put('/api/v1/me/preferences/schedule', { schedule: newSchedule });
      setSchedule(newSchedule);
    } finally {
      setSaving(false);
    }
  }

  function updateTier(tier: keyof Schedule, updates: Partial<ScheduleItem>) {
    const info = TIER_INFO[tier];
    const current = schedule[tier] || { enabled: false, time: '09:00', count: info.defaultCount };
    const newSchedule = { ...schedule, [tier]: { ...current, ...updates } };
    save(newSchedule);
  }

  if (loading) return <div className="p-4">Loading...</div>;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">推送时间表</h1>
        <p className="text-neutral-500 mt-1">配置每天收到 Digest 的时间和条目数量。</p>
      </div>

      {(Object.keys(TIER_INFO) as (keyof typeof TIER_INFO)[]).map((tier) => {
        const info = TIER_INFO[tier];
        const item = schedule[tier] || { enabled: false, time: '09:00', count: info.defaultCount };

        return (
          <Card key={tier}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{info.emoji} {info.name}</CardTitle>
                  <CardDescription>{info.desc}</CardDescription>
                </div>
                <Switch
                  checked={item.enabled}
                  onCheckedChange={(enabled) => updateTier(tier, { enabled })}
                />
              </div>
            </CardHeader>
            {item.enabled && (
              <CardContent>
                <div className="flex gap-4 items-center">
                  <div>
                    <label className="text-sm font-medium">时间</label>
                    <Input
                      type="time"
                      value={item.time}
                      onChange={(e) => updateTier(tier, { time: e.target.value })}
                      className="w-32"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">条目数</label>
                    <Input
                      type="number"
                      value={item.count}
                      min={1}
                      max={20}
                      onChange={(e) => updateTier(tier, { count: parseInt(e.target.value) || info.defaultCount })}
                      className="w-20"
                    />
                  </div>
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
