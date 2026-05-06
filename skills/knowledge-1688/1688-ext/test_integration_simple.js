// test_integration.js - 验证语义推荐完整流程（使用已导出 JSON）
// 模拟：关键词加载 → BM25 → 语义重排 → mtop 调用

const fs = require('fs');
const path = require('path');

const KEYWORDS_PATH = path.join(__dirname, 'keywords.json');

// 1. 加载关键词
let mockStorage = { keywords: [] };
function loadKeywords() {
  const data = fs.readFileSync(KEYWORDS_PATH, 'utf8');
  mockStorage.keywords = JSON.parse(data);
  console.log('📦 加载关键词: ' + mockStorage.keywords.length + ' 条');
}

// 2. BM25 文本匹配
function bm25Search(query, limit = 20) {
  const terms = query.toLowerCase().split(/[\s,，]+/).filter(t => t.length > 0);
  return mockStorage.keywords
    .filter(kw => terms.some(t => kw.word.includes(t)))
    .slice(0, limit)
    .map(kw => ({ keyword: kw.word, score: kw.heat }));
}

// 3. 语义排序（调用 Ollama）
class TestRanker {
  async embed(text) {
    const resp = await fetch('http://localhost:11434/api/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'nomic-embed-text', prompt: text })
    });
    const json = await resp.json();
    return json.embedding;
  }

  keywordToSentence(keyword) {
    const hints = {
      '项链': '颈部饰品，装饰用',
      '手链': '手腕饰品，装饰用',
      '耳环': '耳部饰品，装饰用',
      '戒指': '手指饰品，装饰用',
      'T恤': '上衣，棉质服装',
      '水杯': '饮水容器，日用品'
    };
    return keyword + ': ' + (hints[keyword] || '1688 商品关键词');
  }

  async rerank(query, candidates, topK = 3) {
    const qv = await this.embed(query);
    const scored = [];

    for (const cand of candidates) {
      const kv = await this.embed(this.keywordToSentence(cand.keyword));
      const sim = cosineSim(qv, kv);
      scored.push({ ...cand, semantic_sim: sim, final_score: 0.4 * cand.score + 0.6 * sim });
    }

    return scored.sort((a, b) => b.final_score - a.final_score).slice(0, topK);
  }
}

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// 4. 完整流程
async function test(query) {
  console.log('\n🔍 测试查询: "' + query + '"');

  const candidates = bm25Search(query, 30);
  console.log('📊 BM25 候选: ' + candidates.length + ' 条');
  if (candidates.length === 0) {
    console.log('❌ 无候选');
    return;
  }

  const ranker = new TestRanker();
  const topKeywords = await ranker.rerank(query, candidates, 3);

  console.log('🎯 推荐关键词:');
  topKeywords.forEach((k, i) => {
    console.log('  ' + (i + 1) + '. ' + k.keyword + ' (语义:' + k.semantic_sim.toFixed(3) + ')');
  });
}

async function main() {
  loadKeywords();

  console.log('🚀 开始集成测试（需 Ollama 运行中）...');
  await test('项链');
  await test('手链');
  await test('耳环');
  console.log('\n✅ 测试完成');
}

main().catch(err => {
  console.error('❌ 失败:', err.message);
  process.exit(1);
});
