const KNOWN_ENTITIES = [
  // Companies / products
  'OpenAI', 'Anthropic', 'Google', 'Apple', 'Microsoft', 'Meta', 'Amazon', 'Tesla', 'NVIDIA',
  'ByteDance', 'Tencent', 'Alibaba', 'Huawei', 'TSMC', 'Intel', 'AMD', 'Qualcomm', 'xAI',
  'ChatGPT', 'Claude', 'Gemini', 'Llama', 'Copilot', 'iPhone', 'Android', 'Windows',
  // Countries / regions
  'United States', 'US', 'USA', 'China', 'Japan', 'South Korea', 'India', 'Russia', 'Ukraine',
  'European Union', 'EU', 'Taiwan', 'Hong Kong', 'Singapore',
  // Orgs
  'NATO', 'UN', 'WHO', 'FDA', 'SEC', 'FTC',
  // Chinese entities
  '中国', '美国', '欧盟', '日本', '韩国', '俄罗斯', '乌克兰', '台湾', '香港', '新加坡',
  '腾讯', '阿里巴巴', '字节跳动', '华为', '英伟达', '微软', '谷歌', '苹果', '特斯拉', 'OpenAI',
] as const;

const EN_STOPWORDS = new Set([
  'A', 'An', 'And', 'As', 'At', 'By', 'For', 'From', 'In', 'Into', 'Of', 'On', 'Or', 'The', 'To', 'With',
  'Breaking', 'Latest', 'Update', 'News', 'Live', 'Today', 'China', 'US',
]);

const CHINESE_SURNAMES = [
  '王', '李', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴', '徐', '孙', '胡', '朱', '高', '林',
  '何', '郭', '马', '罗', '梁', '宋', '郑', '谢', '韩', '唐', '冯', '于', '董', '萧', '程',
] as const;

export function extractEntities(title: string, summary = ''): string[] {
  const rawTitle = title?.trim() || '';
  const rawSummary = summary?.trim() || '';
  const text = `${rawTitle} ${rawSummary}`.trim();

  if (!text) return [];

  const entities: string[] = [];
  const seen = new Set<string>();

  const pushEntity = (value: string) => {
    const entity = value.trim().replace(/\s+/g, ' ');
    if (!entity) return;
    const key = /[a-zA-Z]/.test(entity) ? entity.toLowerCase() : entity;
    if (seen.has(key)) return;
    seen.add(key);
    entities.push(entity);
  };

  for (const candidate of KNOWN_ENTITIES) {
    if (containsEntity(text, candidate)) {
      pushEntity(candidate);
    }
  }

  for (const acronym of text.match(/\b[A-Z]{2,}(?:\s+[A-Z]{2,})*\b/g) ?? []) {
    if (acronym.length >= 2 && acronym.length <= 16) {
      pushEntity(acronym);
    }
  }

  for (const phrase of text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g) ?? []) {
    if (EN_STOPWORDS.has(phrase)) continue;
    if (phrase.length <= 2) continue;
    pushEntity(phrase);
  }

  // Chinese org-like entities, e.g. "国家发改委", "某某公司", "某某集团"
  for (const phrase of text.match(/[\u4e00-\u9fff]{2,12}(?:公司|集团|大学|研究院|委员会|政府|法院|银行|部|局)/g) ?? []) {
    pushEntity(phrase);
  }

  // Chinese person name heuristic: surname + 1/2 chars with nearby person-role keywords.
  const personContext = /(表示|宣布|称|指出|会见|总统|总理|首相|CEO|创始人|部长|主席)/;
  if (personContext.test(text)) {
    for (const surname of CHINESE_SURNAMES) {
      const regex = new RegExp(`${surname}[\\u4e00-\\u9fff]{1,2}`, 'g');
      for (const name of text.match(regex) ?? []) {
        pushEntity(name);
      }
    }
  }

  return entities.slice(0, 20);
}

function containsEntity(text: string, entity: string): boolean {
  if (/^[A-Za-z0-9 .-]+$/.test(entity)) {
    const escaped = entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
  }
  return text.includes(entity);
}
