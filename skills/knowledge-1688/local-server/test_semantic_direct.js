// 测试 semantic_ranker 完整链路
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { SemanticRanker } from './semantic_ranker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载关键词
import { readFileSync } from 'fs';
const keywordsPath = join(__dirname, 'keywords.json');
let keywords = [];
try {
  const data = readFileSync(keywordsPath, 'utf8');
  keywords = JSON.parse(data);
  console.log(`✅ 关键词库加载: ${keywords.length} 条`);
} catch (err) {
  console.error('❌ 关键词库加载失败:', err.message);
  process.exit(1);
}

// 初始化 ranker
const ranker = new SemanticRanker({ provider: 'ollama' });
await ranker.initializeTFIDF(keywords);
console.log(`🧠 SemanticRanker 就绪`);

// 测试查询
const query = '项链';
const candidates = keywords
  .filter(k => k.word.toLowerCase().includes(query.toLowerCase()))
  .slice(0, 10)
  .map(k => ({ word: k.word, type: k.type, heat: k.heat || 1 }));

console.log(`\n🔍 测试查询: "${query}"`);
console.log(`候选词: ${candidates.map(c => c.word).join(', ')}`);

try {
  const results = await ranker.rerank(query, candidates, 5);
  console.log(`\n✅ 重排结果:`);
  results.forEach((r, i) => {
    console.log(`  ${i+1}. ${r.word} (score=${r.score.toFixed(4)}) [BM25=${r.scores.bm25.toFixed(3)}, TFIDF=${r.scores.tfidf.toFixed(3)}, semantic=${r.scores.semantic.toFixed(3)}]`);
  });
} catch (err) {
  console.error('❌ 重排失败:', err);
  console.error(err.stack);
}
