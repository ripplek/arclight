const KNOWN_ENTITIES = [
  // === Companies / Tech Giants ===
  'OpenAI', 'Anthropic', 'Google', 'Apple', 'Microsoft', 'Meta', 'Amazon', 'Tesla', 'NVIDIA',
  'ByteDance', 'Tencent', 'Alibaba', 'Huawei', 'TSMC', 'Intel', 'AMD', 'Qualcomm', 'xAI',
  'Samsung', 'Sony', 'IBM', 'Oracle', 'Salesforce', 'Adobe', 'Netflix', 'Spotify', 'Uber',
  'Airbnb', 'Palantir', 'Snowflake', 'Databricks', 'Stripe', 'SpaceX', 'Baidu', 'JD.com',
  'Xiaomi', 'OPPO', 'Vivo', 'DJI', 'BYD', 'NIO', 'XPeng', 'Li Auto', 'Meituan', 'Pinduoduo',
  'DeepMind', 'Cohere', 'Stability AI', 'Mistral AI', 'Inflection AI', 'Character AI',
  'Runway', 'Scale AI', 'Weights & Biases', 'Hugging Face', 'Replicate',

  // === AI Models / Tools ===
  'ChatGPT', 'Claude', 'Gemini', 'Llama', 'Copilot', 'GPT-4', 'GPT-4o', 'GPT-5',
  'Llama 2', 'Llama 3', 'Mistral', 'Mixtral', 'Grok', 'DeepSeek', 'Qwen', 'Yi',
  'Sora', 'Midjourney', 'Stable Diffusion', 'DALL-E', 'Firefly', 'Imagen',
  'Perplexity', 'Cursor', 'Replit', 'GitHub Copilot', 'Tabnine', 'Codeium',
  'Whisper', 'ElevenLabs', 'Runway Gen-2', 'Pika', 'HeyGen', 'Synthesia',

  // === Tech Products / Platforms ===
  'iPhone', 'Android', 'Windows', 'macOS', 'Linux', 'iOS', 'iPadOS',
  'Vision Pro', 'Quest', 'Meta Quest', 'HoloLens', 'PlayStation', 'Xbox', 'Switch',
  'Starlink', 'CyberTruck', 'Cybertruck', 'Neuralink', 'Optimus',
  'GitHub', 'GitLab', 'Bitbucket', 'Figma', 'Notion', 'Slack', 'Discord',
  'Zoom', 'Teams', 'Google Meet', 'Webex',
  'TikTok', 'Instagram', 'WhatsApp', 'Telegram', 'Signal', 'WeChat', 'Line',
  'YouTube', 'Twitch', 'Reddit', 'Twitter', 'Threads', 'Bluesky', 'Mastodon',
  'AWS', 'Azure', 'Google Cloud', 'GCP', 'Cloudflare', 'Vercel', 'Supabase',
  'Kubernetes', 'Docker', 'Terraform', 'Ansible',

  // === Finance / Markets ===
  'Fed', 'Federal Reserve', 'ECB', 'IMF', 'World Bank', 'OPEC', 'OPEC+',
  'S&P 500', 'S&P', 'Nasdaq', 'Dow Jones', 'NYSE', 'FTSE', 'Nikkei', 'Hang Seng',
  'Bitcoin', 'BTC', 'Ethereum', 'ETH', 'Solana', 'Dogecoin', 'XRP', 'USDT', 'USDC',
  'Coinbase', 'Binance', 'Kraken', 'FTX', 'Tether',
  'Goldman Sachs', 'JPMorgan', 'Morgan Stanley', 'BlackRock', 'Vanguard', 'Fidelity',
  'Visa', 'Mastercard', 'PayPal', 'Square', 'Block', 'Ant Group', 'Alipay',

  // === Countries / Regions ===
  'United States', 'US', 'USA', 'China', 'Japan', 'South Korea', 'India', 'Russia', 'Ukraine',
  'European Union', 'EU', 'Taiwan', 'Hong Kong', 'Singapore', 'United Kingdom', 'UK',
  'Germany', 'France', 'Italy', 'Spain', 'Canada', 'Australia', 'Brazil', 'Mexico',
  'Indonesia', 'Vietnam', 'Thailand', 'Philippines', 'Malaysia',
  'Saudi Arabia', 'UAE', 'Israel', 'Iran', 'Turkey', 'Egypt', 'South Africa', 'Nigeria',
  'Taiwan Strait', 'South China Sea', 'Gaza', 'West Bank', 'Crimea', 'Donbas',

  // === Geopolitical Orgs / Groups ===
  'NATO', 'UN', 'WHO', 'FDA', 'SEC', 'FTC', 'FCC', 'EPA', 'DOJ', 'FBI', 'CIA', 'NSA',
  'ASEAN', 'BRICS', 'G7', 'G20', 'AUKUS', 'Quad', 'SCO', 'APEC', 'RCEP',
  'Hamas', 'Hezbollah', 'Houthi', 'Taliban', 'ISIS', 'Al-Qaeda',
  'WTO', 'ICC', 'ICJ', 'IAEA', 'UNESCO', 'UNICEF', 'UNHCR',
  'CCP', 'Politburo', 'State Council', 'PLA', 'NDRC',

  // === Important People ===
  'Elon Musk', 'Sam Altman', 'Jensen Huang', 'Tim Cook', 'Satya Nadella',
  'Mark Zuckerberg', 'Sundar Pichai', 'Jeff Bezos', 'Andy Jassy', 'Reed Hastings',
  'Dario Amodei', 'Demis Hassabis', 'Ilya Sutskever', 'Andrej Karpathy',
  'Jack Dorsey', 'Marc Andreessen', 'Peter Thiel', 'Reid Hoffman',
  'Warren Buffett', 'Jamie Dimon', 'Larry Fink', 'Michael Saylor',
  'Joe Biden', 'Donald Trump', 'Xi Jinping', 'Vladimir Putin',
  'Volodymyr Zelenskyy', 'Zelenskyy', 'Benjamin Netanyahu', 'Netanyahu', 'Modi',
  'Rishi Sunak', 'Emmanuel Macron', 'Olaf Scholz', 'Fumio Kishida',

  // === Chinese Entities (Organizations) ===
  '中国', '美国', '欧盟', '日本', '韩国', '俄罗斯', '乌克兰', '台湾', '香港', '新加坡',
  '腾讯', '阿里巴巴', '字节跳动', '华为', '英伟达', '微软', '谷歌', '苹果', '特斯拉',
  '百度', '小米', '京东', '美团', '拼多多', '网易', '比亚迪', '蔚来', '小鹏', '理想',
  '台积电', '三星', '索尼', '高通', '英特尔', '中芯国际', '长江存储',
  '中国人民银行', '央行', '发改委', '工信部', '商务部', '外交部', '科技部',
  '国务院', '中共中央', '全国人大', '全国政协',
  '习近平', '李强', '王毅', '秦刚',

  // === Chinese Entities (Finance / Markets) ===
  '上证指数', '深证成指', '恒生指数', '纳斯达克', '标普500', '道琼斯',
  '比特币', '以太坊', '加密货币', '数字货币', '人民币', '美元', '欧元',
  '茅台', '中石油', '中石化', '工商银行', '建设银行', '招商银行', '平安保险',
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
  for (const phrase of text.match(/[\u4e00-\u9fff]{2,12}(?:公司|集团|大学|学院|研究院|研究所|委员会|政府|法院|银行|保险|证券|基金|部|局|厅|处|办|院|所|协会|联盟|联合会|商会|平台|中心|工厂|医院|医疗|科技|网络|传媒|控股|投资|资本|电子|能源|汽车|航空|航天)/g) ?? []) {
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
