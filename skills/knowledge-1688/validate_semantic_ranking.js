// validate_semantic_ranking.js - 验证语义排序效果（v2.0 - 修复 BM25）
// 对比 BM25 文本匹配 vs 混合排序（BM25 40% + 语义 60%）

const sqlite3 = require('sqlite3');
const SemanticRanker = require('./semantic_ranker');
const KeywordServiceSemantic = require('./keyword_service_semantic');

const DB_PATH = 'E:/1688标题生成/data/1688.db';
const TEST_QUERIES = ['项链', '手链', '耳环', 'T恤', '水杯'];
const SAMPLE_SIZE = 200;   // 减少到 200 条（验证用）

async function main() {
  console.log('🔍 语义排序验证（修复版）\n');
  console.log('📋 数据库: ' + DB_PATH);
  console.log('📋 测试查询: ' + TEST_QUERIES.join(', '));
  console.log('📋 采样大小: ' + SAMPLE_SIZE + ' 条\n');

  const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);
  const ranker = new SemanticRanker({ provider: 'ollama' });
  const service = new KeywordServiceSemantic(db);

  console.log('🧠 Embedding Provider: ' + ranker.getStats().embedding.provider + '\n');

  for (const query of TEST_QUERIES) {
    console.log('═'.repeat(50));
    console.log('📝 查询: "' + query + '"');
    console.log('═'.repeat(50));

    const candidates = await service.bm25Search(query, SAMPLE_SIZE);
    console.log('📊 BM25 文本匹配候选: ' + candidates.length + ' 条');

    if (candidates.length === 0) {
      console.log('⚠️  无候选，跳过\n');
      continue;
    }

    const bm25Top10 = candidates
      .sort((a, b) => b.bm25_score - a.bm25_score)
      .slice(0, 10);

    console.log('\n🔤 BM25 文本匹配（前 10）:');
    bm25Top10.forEach((item, idx) => {
      console.log('  ' + (idx + 1) + '. ' + item.keyword + ' (score: ' + item.bm25_score.toFixed(4) + ')');
    });

    const reranked = await ranker.rerankBySemantic(query, candidates, 10, 0.4);

    console.log('\n🧠 混合排序（BM25 40% + 语义 60%）前 10:');
    reranked.forEach((item, idx) => {
      console.log('  ' + (idx + 1) + '. ' + item.keyword);
      console.log('     BM25: ' + item.bm25_score.toFixed(4) + ' | 语义: ' + item.semantic_sim.toFixed(4) + ' | 综合: ' + item.final_score.toFixed(4));
    });

    const bm25Words = new Set(bm25Top10.map(i => i.keyword));
    const semanticNew = reranked.filter(i => !bm25Words.has(i.keyword));
    if (semanticNew.length > 0) {
      console.log('\n✨ 语义排序新增的相关词（BM25 未匹配）:');
      semanticNew.forEach(item => {
        console.log('  • ' + item.keyword + ' (语义分: ' + item.semantic_sim.toFixed(4) + ')');
      });
    } else {
      console.log('\n✅ BM25 与语义排序前 10 一致（无新增）');
    }

    console.log('\n');
  }

  db.close();
  ranker.clearCache();
  console.log('✅ 验证完成（BM25 已修复为文本匹配）');
}

main().catch(err => {
  console.error('❌ 验证失败:', err);
  process.exit(1);
});
