// test_integration.js - 验证语义推荐完整流程（无扩展环境）
// 模拟：关键词加载 → BM25 → 语义重排 → mtop 调用

const sqlite3 = require('sqlite3');

// 模拟 chrome.storage.local
const mockStorage = {
  keywords: null,
  get: async (key) => ({ [key]: mockStorage[key] }),
  set: async (obj) => Object.assign(mockStorage, obj)
};

// 1. 加载关键词到 mock storage
function loadKeywords() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database('E:/1688标题生成/data/1688.db', sqlite3.OPEN_READONLY);
    db.serialize(() => {
      db.all('SELECT word, type, heat FROM keywords ORDER BY heat DESC LIMIT 5000', [], (err, rows) => {
        if (err) reject(err);
        else {
          mockStorage.keywords = rows.map(r => ({ word: r.word, type: r.type, heat: r.heat || 0 }));
          console.log('📦 加载关键词: ' + mockStorage.keywords.length + ' 条');
          resolve();
        }
      });
    });
  });
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
    const hints = { '项链': '颈部饰品', '手链': '手腕饰品', '耳环': '耳部饰品' };
    return keyword + ': ' + (hints[keyword] || '1688 商品');
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

  // BM25
  const candidates = bm25Search(query, 30);
  console.log('📊 BM25 候选: ' + candidates.length + ' 条');
  if (candidates.length === 0) {
    console.log('❌ 无候选');
    return;
  }

  // 语义重排
  const ranker = new TestRanker();
  const topKeywords = await ranker.rerank(query, candidates, 3);

  console.log('🎯 推荐关键词:');
  topKeywords.forEach((k, i) => {
    console.log('  ' + (i + 1) + '. ' + k.keyword + ' (语义:' + k.semantic_sim.toFixed(3) + ')');
  });

  // 模拟 mtop（这里只打印，不真实调用）
  console.log('⏳ 将获取这些关键词的商品（mtop API）...');
}

// 主函数
async function main() {
  await loadKeywords();

  await test('项链');
  await test('手链');
  await test('耳环');
}

main().catch(console.error);
