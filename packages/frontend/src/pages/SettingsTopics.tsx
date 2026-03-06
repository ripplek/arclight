import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

interface Topic {
  name: string;
  keywords: string[];
  excludeKeywords?: string[];
  boost: number;
}

export default function SettingsTopics() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [templates, setTemplates] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editTopic, setEditTopic] = useState<Topic>({ name: '', keywords: [], boost: 1.0 });
  const [keywordInput, setKeywordInput] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [prefsRes, templatesRes] = await Promise.all([
        api.get<{ data: { topics: Topic[] } }>('/api/v1/me/preferences'),
        api.get<{ data: Topic[] }>('/api/v1/me/preferences/topic-templates'),
      ]);
      setTopics(prefsRes.data.topics || []);
      setTemplates(templatesRes.data);
    } finally {
      setLoading(false);
    }
  }

  async function saveTopics(newTopics: Topic[]) {
    setSaving(true);
    try {
      await api.put('/api/v1/me/preferences/topics', { topics: newTopics });
      setTopics(newTopics);
    } finally {
      setSaving(false);
    }
  }

  function openAddDialog() {
    setEditIndex(null);
    setEditTopic({ name: '', keywords: [], boost: 1.0 });
    setKeywordInput('');
    setDialogOpen(true);
  }

  function openEditDialog(index: number) {
    setEditIndex(index);
    setEditTopic({ ...topics[index] });
    setKeywordInput('');
    setDialogOpen(true);
  }

  function addKeyword() {
    const kw = keywordInput.trim();
    if (kw && !editTopic.keywords.includes(kw)) {
      setEditTopic({ ...editTopic, keywords: [...editTopic.keywords, kw] });
    }
    setKeywordInput('');
  }

  function removeKeyword(kw: string) {
    setEditTopic({ ...editTopic, keywords: editTopic.keywords.filter((k) => k !== kw) });
  }

  function saveTopic() {
    if (!editTopic.name || editTopic.keywords.length === 0) return;
    const newTopics = [...topics];
    if (editIndex !== null) {
      newTopics[editIndex] = editTopic;
    } else {
      newTopics.push(editTopic);
    }
    saveTopics(newTopics);
    setDialogOpen(false);
  }

  function removeTopic(index: number) {
    const newTopics = topics.filter((_, i) => i !== index);
    saveTopics(newTopics);
  }

  function addTemplate(template: Topic) {
    if (topics.some((t) => t.name === template.name)) return;
    saveTopics([...topics, template]);
  }

  if (loading) return <div className="p-4">Loading...</div>;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Topic 偏好配置</h1>
        <p className="text-neutral-500 mt-1">管理你关注的 Topic，影响 Digest 中新闻的排序权重。</p>
      </div>

      {topics.map((topic, i) => (
        <Card key={i}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">{topic.name}</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => openEditDialog(i)}>编辑</Button>
                <Button variant="outline" size="sm" onClick={() => removeTopic(i)}>×</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1">
                {topic.keywords.map((kw) => (
                  <Badge key={kw} variant="secondary">{kw}</Badge>
                ))}
              </div>
              {topic.excludeKeywords && topic.excludeKeywords.length > 0 && (
                <div className="text-sm text-neutral-500">
                  排除: {topic.excludeKeywords.join(', ')}
                </div>
              )}
              <div className="text-sm text-neutral-500">
                权重: {topic.boost}x
              </div>
            </div>
          </CardContent>
        </Card>
      ))}

      <Button onClick={openAddDialog}>+ 添加 Topic</Button>

      <div className="pt-4 border-t">
        <h3 className="font-semibold mb-2">推荐 Topic 模板</h3>
        <div className="flex flex-wrap gap-2">
          {templates.map((t) => (
            <Button
              key={t.name}
              variant="outline"
              size="sm"
              disabled={topics.some((existing) => existing.name === t.name)}
              onClick={() => addTemplate(t)}
            >
              {t.name}
            </Button>
          ))}
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editIndex !== null ? '编辑 Topic' : '添加 Topic'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">名称</label>
              <Input
                value={editTopic.name}
                onChange={(e) => setEditTopic({ ...editTopic, name: e.target.value })}
                placeholder="如: AI 产业"
              />
            </div>
            <div>
              <label className="text-sm font-medium">关键词</label>
              <div className="flex gap-2 mt-1">
                <Input
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(); } }}
                  placeholder="输入关键词后回车"
                />
                <Button onClick={addKeyword} variant="outline">添加</Button>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {editTopic.keywords.map((kw) => (
                  <Badge key={kw} variant="secondary" className="cursor-pointer" onClick={() => removeKeyword(kw)}>
                    {kw} ×
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">权重: {editTopic.boost}x</label>
              <Slider
                value={[editTopic.boost]}
                onValueChange={([v]) => setEditTopic({ ...editTopic, boost: Math.round(v * 10) / 10 })}
                min={0.1}
                max={5.0}
                step={0.1}
                className="mt-2"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={saveTopic} disabled={!editTopic.name || editTopic.keywords.length === 0}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
