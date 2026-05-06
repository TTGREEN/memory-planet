// semantic_ranker.js - 语义相似度排序模块（v2.0 - 多 provider）
// 基于句子级 embedding + 多后端支持（Ollama | MiniMax）

const EmbeddingManager = require('./embedding_manager');

class SemanticRanker {
  constructor(options = {}) {
    this.embedding = new EmbeddingManager(options);
    this.cache = new Map();  // 关键词 → 向量（额外缓存，避免重复转换）
  }

  /**
   * 关键词转句子（增加上下文）
   */
  keywordToSentence(keyword) {
    const categoryHints = {
      '项链': '颈部饰品，装饰用',
      '手链': '手腕饰品，装饰用',
      '耳环': '耳部饰品，装饰用',
      '戒指': '手指饰品，装饰用',
      'T恤': '上衣，棉质服装',
      '水杯': '饮水容器，日用品',
      '手机壳': '手机保护配件',
      '不锈钢': '金属材料，耐腐蚀',
      '钛钢': '金属材料，高强度'
    };

    const hint = categoryHints[keyword] || '1688 商品关键词';
    return `${keyword}: ${hint}`;
  }

  /**
   * 获取关键词向量（带缓存）
   */
  async getKeywordVector(keyword) {
    const cacheKey = `kw:${keyword}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const sentence = this.keywordToSentence(keyword);
    const vector = await this.embedding.getEmbedding(sentence);
    this.cache.set(cacheKey, vector);
    return vector;
  }

  /**
   * 计算查询与关键词的语义相似度
   */
  async computeSemanticSimilarity(query, keyword) {
    const queryVec = await this.embedding.getEmbedding(query);
    const keywordVec = await this.getKeywordVector(keyword);
    return this.cosineSim(queryVec, keywordVec);
  }

  /**
   * 余弦相似度
   */
  cosineSim(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * 混合重排
   * @param {string} query - 用户查询
   * @param {Array<{keyword:string, bm25_score:number}>} candidates - BM25 候选
   * @param {number} topK - 返回数量
   * @param {number} alpha - BM25 权重（默认 0.4）
   */
  async rerankBySemantic(query, candidates, topK = 20, alpha = 0.4) {
    const results = [];

    // 批量计算查询向量（只算一次）
    const queryVec = await this.embedding.getEmbedding(query);

    for (const cand of candidates) {
      const kwVec = await this.getKeywordVector(cand.keyword);
      const semanticSim = this.cosineSim(queryVec, kwVec);
      const finalScore = alpha * cand.bm25_score + (1 - alpha) * semanticSim;

      results.push({
        keyword: cand.keyword,
        bm25_score: cand.bm25_score,
        semantic_sim: semanticSim,
        final_score: finalScore
      });
    }

    results.sort((a, b) => b.final_score - a.final_score);
    return results.slice(0, topK);
  }

  /**
   * 清空缓存
   */
  clearCache() {
    this.cache.clear();
    this.embedding.clearCache();
  }

  /**
   * 获取统计
   */
  getStats() {
    return {
      embedding: this.embedding.getStats(),
      keywordCacheSize: this.cache.size
    };
  }
}

module.exports = SemanticRanker;
