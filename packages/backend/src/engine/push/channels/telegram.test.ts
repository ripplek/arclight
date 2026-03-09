import { describe, expect, it } from 'vitest';
import { renderDigest } from '../../digest/renderer.js';
import { TelegramChannel } from './telegram.js';
import type { EnhancedItem } from '../../digest/ai-enhance.js';

function makeItem(): EnhancedItem {
  return {
    id: 'item-1',
    sourceId: 'source-1',
    url: 'https://example.com/story',
    title: 'Original source title',
    content: 'Longer body used for deep digest testing.',
    author: null,
    language: 'en',
    tier: 1,
    publishedAt: new Date('2026-03-10T00:00:00.000Z'),
    fetchedAt: new Date('2026-03-10T00:10:00.000Z'),
    entities: [],
    tags: [],
    score: 1,
    topicMatches: ['AI'],
    enhanced: {
      category: '国际局势',
      categoryEmoji: '🌍',
      chineseTitle: '中文标题A',
      summary: '这里是真正的摘要。',
      whyImportant: '影响很大',
      context: '前情提要',
    },
    arcInfo: {
      id: 'arc-1',
      title: '伊朗局势升级',
      status: 'active',
      summary: '以伊冲突再度升级，外交与军事回应同步发酵',
    },
  };
}

function makePayload(tier: 'daily' | 'deep') {
  const rendered = renderDigest([makeItem()], tier, '2026-03-10');
  return {
    digestId: 'digest-1',
    userId: 'user-1',
    title: 'test',
    tier,
    date: '2026-03-10',
    itemCount: 1,
    contentMarkdown: rendered.markdown,
    contentHtml: rendered.html,
    webUrl: 'https://app.arclight.test/digests/digest-1',
  };
}

describe('TelegramChannel story arc formatting', () => {
  it('keeps daily summary and renders story arc as a clickable line', () => {
    const payload = makePayload('daily');
    const channel = new TelegramChannel('dummy-token');
    const message = (channel as any).formatDaily(payload) as string;

    expect(payload.contentHtml).toContain('href="/arcs/arc-1"');
    expect(message).toContain('📖 <a href="https://app.arclight.test/arcs/arc-1">伊朗局势升级</a>');
    expect(message).toContain('这里是真正的摘要。');
    expect(message).not.toContain('**伊朗局势升级**');
  });

  it('keeps deep summary/context/why-important without leaking markdown markers', () => {
    const payload = makePayload('deep');
    const channel = new TelegramChannel('dummy-token');
    const message = (channel as any).formatDeep(payload) as string;

    expect(message).toContain('📖 <a href="https://app.arclight.test/arcs/arc-1">伊朗局势升级</a>');
    expect(message).toContain('这里是真正的摘要。');
    expect(message).toContain('📎 <i>前情提要</i>');
    expect(message).toContain('💡 影响很大');
    expect(message).not.toContain('&gt;');
    expect(message).not.toContain('**为什么重要**');
  });
});
