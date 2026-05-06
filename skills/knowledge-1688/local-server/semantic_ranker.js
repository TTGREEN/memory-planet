// local-server/semantic_ranker.js - 语义排序器（优化版）
// 功能：BM25 初筛 + TF-IDF 加权 + 语义重排（三路混合）
// 优化：短文本 embedding 修复 + 动态权重 + 缓存优化

import { EmbeddingManager } from './embedding_manager.js';

/**
 * 关键词转句子（解决短文本 embedding 异常）
 * 策略：词长 ≤3 时添加类目上下文，长词直接返回
 */
export function keywordToSentence(keyword) {
  if (!keyword) return keyword;

  const len = keyword.length;
  if (len <= 3) {
    const categoryMap = {
      '项链': '首饰 饰品 佩戴',
      '手链': '首饰 手饰 佩戴',
      '手环': '首饰 手饰 佩戴',
      '耳环': '首饰 耳饰 佩戴',
      '耳坠': '首饰 耳饰 佩戴',
      '戒指': '首饰 戒饰 佩戴',
      '毛衣': '服装 衣服 秋冬',
      'T恤': '服装 上衣 夏装',
      '衬衫': '服装 上衣 正装',
      '连衣裙': '服装 女装 裙装',
      '手机壳': '配件 保护套 数码',
      '耳机': '数码 音频 无线',
      '包包': '箱包 配饰 时尚'
    };
    const expansion = categoryMap[keyword];
    return expansion ? `${keyword} ${expansion}` : `${keyword} ${keyword} ${keyword}`;
  }
  return keyword;
}

/**
 * 余弦相似度（向量化计算）
 */
export function cosineSim(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * 语义排序器（混合三路）
 */
export class SemanticRanker {
  constructor(options = {}) {
    this.embedding = new EmbeddingManager(options);
    this.alpha = 0.4;   // BM25 权重
    this.beta = 0.2;    // TF-IDF 权重
    this.gamma = 0.4;   // 语义权重（alpha + beta + gamma = 1.0）
    this.tfidf = null;
    this.keywords = [];
    this.idfCache = null;
  }

  /**
   * 初始化 TF-IDF（从 keywords 表计算文档频率）
   */
  async initializeTFIDF(keywords) {
    if (!keywords || keywords.length === 0) return;
    this.keywords = keywords;

    const docFreq = new Map();
    keywords.forEach(kw => {
      const words = (kw.word || '').toLowerCase().split(/[\s-]+/);
      const unique = new Set(words);
      unique.forEach(w => {
        if (w.length < 2) return;
        docFreq.set(w, (docFreq.get(w) || 0) + 1);
      });
    });

    this.idfCache = new Map();
    for (const [word, df] of docFreq.entries()) {
      this.idfCache.set(word, Math.log(keywords.length / (df + 1)));
    }

    console.log(`[SemanticRanker] TF-IDF 初始化: ${docFreq.size} 词条`);
  }

  /**
   * 混合重排（BM25 + TF-IDF + 语义）
   */
  async rerank(query, candidates, limit = 5) {
    if (!candidates || candidates.length === 0) return [];

    // 延迟初始化 TF-IDF
    if (!this.idfCache && this.keywords.length > 0) {
      await this.initializeTFIDF(this.keywords);
    }

    // 1. 查询词 embedding
    const querySentence = keywordToSentence(query);
    const queryVec = await this.embedding.getEmbedding(querySentence);

    // 2. 候选词 embedding（批量 + 缓存）
    const candidateSentences = candidates.map(c => keywordToSentence(c.word));
    const candidateVecs = await this.embedding.getEmbeddings(candidateSentences, 10);

    // 3. 归一化参数
    const maxHeat = Math.max(...candidates.map(c => c.heat));
    const minHeat = Math.min(...candidates.map(c => c.heat));

    // 4. 综合评分
    const scored = candidates.map((cand, idx) => {
      const vec = candidateVecs[idx];
      const semanticSim = vec ? cosineSim(queryVec, vec) : 0;

      // BM25: 文本匹配 + 热度归一化
      const textMatch = cand.word.includes(query) ? 1.0 : 0.5;
      const heatNorm = (cand.heat - minHeat) / (maxHeat - minHeat + 1e-9);
      const bm25Score = textMatch * heatNorm;

      // TF-IDF: 词内 IDF 加权
      let tfidfScore = 0;
      if (this.idfCache) {
        const words = cand.word.toLowerCase().split(/[\s-]+/);
        let sum = 0;
        words.forEach(w => {
          if (this.idfCache.has(w)) sum += this.idfCache.get(w);
        });
        tfidfScore = sum / (words.length || 1);
      }

      // 混合三路
      const finalScore = this.alpha * bm25Score + this.beta * tfidfScore + this.gamma * semanticSim;

      return {
        word: cand.word,
        type: cand.type,
        category: cand.category,
        heat: cand.heat,
        score: finalScore,
        scores: { bm25: bm25Score, tfidf: tfidfScore, semantic: semanticSim }
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  clearCache() {
    this.embedding.clearCache();
  }

  getStats() {
    return {
      embedding: this.embedding.getStats(),
      cacheSize: this.embedding.cache.size,
      tfidfInitialized: this.idfCache !== null
    };
  }
}
