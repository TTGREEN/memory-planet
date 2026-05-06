// keyword_service_semantic.js - 支持语义排序的关键词服务（v2.0）
// 集成 semantic_ranker，实现混合排序（BM25 + 语义）
// 修复：BM25 使用数据库文本匹配，避免全量加载

const SemanticRanker = require('./semantic_ranker');

class KeywordServiceSemantic {
  constructor(db) {
    this.db = db;  // SQLite 数据库连接
    this.ranker = new SemanticRanker();
  }

  /**
   * 搜索关键词（混合排序）
   * @param {string} query - 用户输入
   * @param {number} limit - 返回数量
   */
  async searchKeywords(query, limit = 20) {
    // 1. BM25 初筛（从数据库检索包含查询词的关键词）
    const bm25Candidates = await this.bm25Search(query, 50);

    if (bm25Candidates.length === 0) {
      //  fallback: 返回热门前 50
      return this.getHotKeywords(limit);
    }

    // 2. 语义重排
    const ranked = await this.ranker.rerankBySemantic(query, bm25Candidates, limit);

    // 3. 返回完整关键词信息
    return Promise.all(ranked.map(async (item) => {
      const keywordInfo = await this.getKeywordInfo(item.keyword);
      return {
        ...keywordInfo,
        bm25_score: item.bm25_score,
        semantic_sim: item.semantic_sim,
        final_score: item.final_score
      };
    }));
  }

  /**
   * BM25 初步搜索（数据库端文本匹配 + 简易评分）
   * 使用 SQLite FTS 或 LIKE 查询，避免全量加载
   */
  async bm25Search(query, limit) {
    return new Promise((resolve, reject) => {
      const terms = this.tokenize(query);
      if (terms.length === 0) {
        resolve([]);
        return;
      }

      // 构建查询：匹配任一词（OR），按热度排序
      const placeholders = terms.map(() => '?').join(',');
      const likeClauses = terms.map(term => 'word LIKE ?').join(' OR ');

      // 参数：'%term1%', '%term2%'...
      const params = terms.map(term => `%${term}%`);

      this.db.all(`
        SELECT word as keyword, heat as bm25_score
        FROM keywords
        WHERE ${likeClauses}
        ORDER BY heat DESC
        LIMIT ?
      `, [...params, limit], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  /**
   * 获取热门关键词（fallback）
   */
  getHotKeywords(limit) {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT word as keyword, heat as bm25_score
        FROM keywords
        ORDER BY heat DESC
        LIMIT ?
      `, [limit], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  /**
   * 获取关键词详情
   */
  async getKeywordInfo(keyword) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT word, type, category, heat, click_rate, convert_rate FROM keywords WHERE word = ?',
        [keyword],
        (err, row) => {
          if (err) return reject(err);
          resolve(row || { word: keyword, type: 'unknown', heat: 0 });
        }
      );
    });
  }

  /**
   * 简单分词
   */
  tokenize(text) {
    return text.toLowerCase()
      .split(/[\s,，]+/)
      .filter(t => t.length > 0);
  }

  /**
   * 清空 embedding 缓存
   */
  clearCache() {
    this.ranker.clearCache();
  }
}

module.exports = KeywordServiceSemantic;
