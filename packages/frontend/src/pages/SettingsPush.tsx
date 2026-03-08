import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface TelegramChannelConfig {
  enabled: boolean;
  chatId?: string;
  botToken?: string;
  bindMethod?: 'manual' | 'bot_start';
  boundAt?: string;
  type?: 'telegram';
}

interface PushChannelsResponse {
  data: {
    configured: {
      telegram?: TelegramChannelConfig;
      [key: string]: unknown;
    };
    available: string[];
  };
}

type PushLogStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'exhausted';

interface PushLog {
  id: string;
  digestId: string;
  channelType: string;
  status: PushLogStatus;
  error?: string | null;
  attempt: number;
  durationMs?: number | null;
  createdAt: string | number;
}

interface PushStatsChannel {
  total: number;
  sent: number;
  failed: number;
}

interface PushStats {
  total: number;
  sent: number;
  failed: number;
  byChannel: Record<string, PushStatsChannel>;
}

interface TestPushResponse {
  success: boolean;
  error?: string;
  durationMs?: number;
}

function getApiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const data = err.data;
    if (typeof data === 'object' && data !== null && 'error' in data) {
      const errorText = (data as { error?: unknown }).error;
      if (typeof errorText === 'string' && errorText) {
        return errorText;
      }
    }
  }

  if (err instanceof Error && err.message) {
    return err.message;
  }

  return fallback;
}

function formatTime(value: string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleString('zh-CN');
}

function statusMeta(status: PushLogStatus): { label: string; className: string } {
  if (status === 'sent') {
    return { label: '已发送', className: 'bg-emerald-600 text-white hover:bg-emerald-600 dark:bg-emerald-500' };
  }

  if (status === 'failed') {
    return { label: '失败', className: 'bg-destructive text-white hover:bg-destructive' };
  }

  if (status === 'exhausted') {
    return { label: '重试耗尽', className: 'bg-amber-500 text-white hover:bg-amber-500' };
  }

  if (status === 'sending') {
    return { label: '发送中', className: 'bg-sky-500 text-white hover:bg-sky-500' };
  }

  return { label: '待发送', className: 'bg-neutral-500 text-white hover:bg-neutral-500' };
}

export default function SettingsPush() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [refreshingHistory, setRefreshingHistory] = useState(false);

  const [availableChannels, setAvailableChannels] = useState<string[]>([]);
  const [historyChannel, setHistoryChannel] = useState('all');

  const [telegram, setTelegram] = useState<TelegramChannelConfig>({ enabled: false, chatId: '', botToken: '' });
  const [showTokenField, setShowTokenField] = useState(false);

  const [logs, setLogs] = useState<PushLog[]>([]);
  const [stats, setStats] = useState<PushStats | null>(null);

  const [formError, setFormError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<{ success: boolean; text: string } | null>(null);
  const [testMessage, setTestMessage] = useState<{ success: boolean; text: string } | null>(null);

  const successRate = useMemo(() => {
    if (!stats || stats.total === 0) return 0;
    return Math.round((stats.sent / stats.total) * 100);
  }, [stats]);

  useEffect(() => {
    loadInitialData();
  }, []);

  async function loadInitialData() {
    setLoading(true);
    try {
      const [channelsRes, historyRes, statsRes] = await Promise.all([
        api.get<PushChannelsResponse>('/api/v1/push/channels'),
        api.get<{ data: PushLog[] }>('/api/v1/push/history?limit=50'),
        api.get<{ data: PushStats }>('/api/v1/push/stats'),
      ]);

      const telegramConfig = channelsRes.data.configured.telegram;
      setAvailableChannels(channelsRes.data.available || []);
      setTelegram({
        enabled: telegramConfig?.enabled ?? false,
        chatId: telegramConfig?.chatId ?? '',
        botToken: telegramConfig?.botToken ?? '',
        bindMethod: telegramConfig?.bindMethod,
        boundAt: telegramConfig?.boundAt,
        type: 'telegram',
      });
      setShowTokenField(Boolean(telegramConfig?.botToken));

      setLogs(historyRes.data);
      setStats(statsRes.data);
    } finally {
      setLoading(false);
    }
  }

  async function reloadChannels() {
    const channelsRes = await api.get<PushChannelsResponse>('/api/v1/push/channels');
    const telegramConfig = channelsRes.data.configured.telegram;

    setAvailableChannels(channelsRes.data.available || []);
    setTelegram({
      enabled: telegramConfig?.enabled ?? false,
      chatId: telegramConfig?.chatId ?? '',
      botToken: telegramConfig?.botToken ?? '',
      bindMethod: telegramConfig?.bindMethod,
      boundAt: telegramConfig?.boundAt,
      type: 'telegram',
    });
    setShowTokenField(Boolean(telegramConfig?.botToken));
  }

  async function loadHistory(channel: string) {
    const query = channel === 'all' ? '?limit=50' : `?limit=50&channel=${encodeURIComponent(channel)}`;
    const historyRes = await api.get<{ data: PushLog[] }>(`/api/v1/push/history${query}`);
    setLogs(historyRes.data);
  }

  async function loadStats() {
    const statsRes = await api.get<{ data: PushStats }>('/api/v1/push/stats');
    setStats(statsRes.data);
  }

  function validateForm(): boolean {
    const chatId = telegram.chatId?.trim() || '';

    if (telegram.enabled && !chatId) {
      setFormError('启用 Telegram 推送时必须填写 Chat ID');
      return false;
    }

    if (chatId && !/^-?\d+$/.test(chatId)) {
      setFormError('Chat ID 需为数字（可带负号）');
      return false;
    }

    setFormError(null);
    return true;
  }

  async function saveTelegramConfig() {
    if (!validateForm()) return;

    setSaving(true);
    setSaveMessage(null);

    try {
      const payload = {
        enabled: telegram.enabled,
        chatId: telegram.chatId?.trim() || undefined,
        botToken: telegram.botToken?.trim() || undefined,
      };

      await api.put('/api/v1/push/channels/telegram', payload);
      setSaveMessage({ success: true, text: '配置已保存' });
      await reloadChannels();
    } catch (err) {
      setSaveMessage({ success: false, text: getApiErrorMessage(err, '保存失败，请稍后重试') });
    } finally {
      setSaving(false);
    }
  }

  async function clearTelegramConfig() {
    setSaving(true);
    setSaveMessage(null);

    try {
      await api.delete('/api/v1/push/channels/telegram');
      await reloadChannels();
      setSaveMessage({ success: true, text: 'Telegram 配置已移除' });
    } catch (err) {
      setSaveMessage({ success: false, text: getApiErrorMessage(err, '移除失败，请稍后重试') });
    } finally {
      setSaving(false);
    }
  }

  async function testPush() {
    if (!validateForm()) return;

    setTesting(true);
    setTestMessage(null);

    try {
      const res = await api.post<TestPushResponse>('/api/v1/push/test', { channelType: 'telegram' });

      if (res.success) {
        const durationText = typeof res.durationMs === 'number' ? `（${res.durationMs}ms）` : '';
        setTestMessage({ success: true, text: `测试推送成功${durationText}` });
      } else {
        setTestMessage({ success: false, text: res.error || '测试推送失败' });
      }

      await Promise.all([loadHistory(historyChannel), loadStats()]);
    } catch (err) {
      setTestMessage({ success: false, text: getApiErrorMessage(err, '测试推送失败') });
    } finally {
      setTesting(false);
    }
  }

  async function refreshHistoryAndStats(channel = historyChannel) {
    setRefreshingHistory(true);
    try {
      await Promise.all([loadHistory(channel), loadStats()]);
    } finally {
      setRefreshingHistory(false);
    }
  }

  async function handleHistoryChannelChange(value: string) {
    setHistoryChannel(value);
    await refreshHistoryAndStats(value);
  }

  if (loading) return <div className="p-4">Loading...</div>;

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">推送渠道设置</h1>
        <p className="text-neutral-500 mt-1">配置 Telegram 推送，并查看最近推送记录和成功率。</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">Telegram 渠道</CardTitle>
                <CardDescription>支持机器人推送 Digest 与测试消息</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-neutral-500">启用</span>
                <Switch
                  checked={telegram.enabled}
                  onCheckedChange={(enabled) => {
                    setTelegram((prev) => ({ ...prev, enabled }));
                    setFormError(null);
                    setSaveMessage(null);
                  }}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Chat ID</label>
              <Input
                value={telegram.chatId || ''}
                onChange={(e) => {
                  setTelegram((prev) => ({ ...prev, chatId: e.target.value }));
                  setFormError(null);
                }}
                placeholder="例如: -1001234567890"
              />
              <p className="text-xs text-neutral-500">启用时必填，仅支持数字。</p>
            </div>

            <div className="space-y-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowTokenField((prev) => !prev)}
                className="px-0 text-neutral-600 dark:text-neutral-400"
              >
                {showTokenField ? '隐藏自定义 Bot Token' : '使用自定义 Bot Token（可选）'}
              </Button>

              {showTokenField && (
                <Input
                  type="password"
                  value={telegram.botToken || ''}
                  onChange={(e) => setTelegram((prev) => ({ ...prev, botToken: e.target.value }))}
                  placeholder="不填则使用系统默认机器人"
                />
              )}
            </div>

            {formError && <p className="text-sm text-destructive">{formError}</p>}

            {saveMessage && (
              <p className={`text-sm ${saveMessage.success ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}>
                {saveMessage.text}
              </p>
            )}

            {testMessage && (
              <p className={`text-sm ${testMessage.success ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}>
                {testMessage.text}
              </p>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="outline" onClick={testPush} disabled={testing || saving}>
                {testing ? '测试中...' : '测试推送'}
              </Button>
              <Button onClick={saveTelegramConfig} disabled={saving || testing}>
                {saving ? '保存中...' : '保存配置'}
              </Button>
              <Button
                variant="ghost"
                className="text-neutral-500"
                onClick={clearTelegramConfig}
                disabled={saving || testing}
              >
                清除配置
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="opacity-65 border-dashed">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Email 渠道</CardTitle>
                <CardDescription>邮件推送能力正在开发中</CardDescription>
              </div>
              <Badge variant="secondary">Coming Soon</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-neutral-500">后续将支持邮箱验证、投递状态追踪与退订管理。</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>推送统计</CardTitle>
              <CardDescription>最近推送表现与渠道成功率概览</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => refreshHistoryAndStats()} disabled={refreshingHistory}>
              {refreshingHistory ? '刷新中...' : '刷新'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-neutral-500">总推送</p>
            <p className="mt-1 text-2xl font-semibold">{stats?.total ?? 0}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-neutral-500">成功</p>
            <p className="mt-1 text-2xl font-semibold text-emerald-600 dark:text-emerald-400">{stats?.sent ?? 0}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-neutral-500">失败</p>
            <p className="mt-1 text-2xl font-semibold text-destructive">{stats?.failed ?? 0}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-neutral-500">成功率</p>
            <p className="mt-1 text-2xl font-semibold">{successRate}%</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>推送历史</CardTitle>
              <CardDescription>最近 50 条推送日志</CardDescription>
            </div>
            <Tabs value={historyChannel} onValueChange={handleHistoryChannelChange}>
              <TabsList>
                <TabsTrigger value="all">全部</TabsTrigger>
                {[...new Set(['telegram', ...availableChannels])].map((channel) => (
                  <TabsTrigger key={channel} value={channel}>{channel}</TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-neutral-500">暂无推送记录</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr className="border-b text-left text-neutral-500">
                    <th className="py-2 pr-4 font-medium">时间</th>
                    <th className="py-2 pr-4 font-medium">渠道</th>
                    <th className="py-2 pr-4 font-medium">状态</th>
                    <th className="py-2 pr-4 font-medium">错误信息</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => {
                    const meta = statusMeta(log.status);
                    return (
                      <tr key={log.id} className="border-b last:border-b-0">
                        <td className="py-3 pr-4 text-neutral-600 dark:text-neutral-300">{formatTime(log.createdAt)}</td>
                        <td className="py-3 pr-4">{log.channelType}</td>
                        <td className="py-3 pr-4">
                          <Badge className={meta.className}>{meta.label}</Badge>
                        </td>
                        <td className="py-3 pr-4 text-neutral-600 dark:text-neutral-300">
                          {log.error || '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {stats && Object.keys(stats.byChannel).length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {Object.entries(stats.byChannel).map(([channel, channelStats]) => (
                <Badge key={channel} variant="outline">
                  {channel}: {channelStats.sent}/{channelStats.total} 成功
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
