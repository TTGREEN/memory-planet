// embedding_manager.js - 统一 Embedding 接口
// 支持多个 provider：Ollama（本地）| MiniMax（云端）| 其他

const MiniMaxEmbedding = require('./minimax_embedding');
const { keywordToSentence } = require('./semantic_ranker');

class EmbeddingManager {
  constructor(options = {}) {
    this.provider = options.provider || 'ollama';  // 'ollama' | 'minimax'
    this.models = {
      ollama: {
        url: 'http://localhost:11434/api/embeddings',
        model: 'nomic-embed-text',
        getEmbedding: this.ollamaEmbed.bind(this)
      },
      minimax: {
        baseUrl: 'https://api.minimaxi.com/v1',
        model: 'embedding-float',
        client: new MiniMaxEmbedding()
      }
    };
    this.cache = new Map();
  }

  /**
   * Ollama 本地 embedding
   */
  async ollamaEmbed(text) {
    if (this.cache.has(`ollama:${text}`)) {
      return this.cache.get(`ollama:${text}`);
    }

    const response = await fetch(this.models.ollama.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.models.ollama.model,
        prompt: text
      })
    });

    const json = await response.json();
    const vec = json.embedding;
    this.cache.set(`ollama:${text}`, vec);
    return vec;
  }

  /**
   * MiniMax 云端 embedding
   */
  async minimaxEmbed(text) {
    return await this.models.minimax.client.embed(text);
  }

  /**
   * 获取 embedding（主入口）
   */
  async getEmbedding(text) {
    if (this.provider === 'minimax') {
      return await this.minimaxEmbed(text);
    }
    return await this.ollamaEmbed(text);
  }

  /**
   * 批量获取（并发控制）
   */
  async getEmbeddings(texts, concurrency = 5) {
    if (this.provider === 'minimax') {
      return await this.models.minimax.client.embedBatch(texts, concurrency);
    }

    // Ollama 批量
    const results = [];
    const semaphore = new Array(concurrency).fill(null);

    await Promise.all(semaphore.map(async (_, idx) => {
      for (let i = idx; i < texts.length; i += concurrency) {
        try {
          results[i] = await this.ollamaEmbed(texts[i]);
        } catch (err) {
          console.error(`Ollama batch failed (${i}):`, err.message);
          results[i] = null;
        }
      }
    }));

    return results;
  }

  /**
   * 计算两个文本的相似度
   */
  async similarity(textA, textB) {
    const [vecA, vecB] = await Promise.all([
      this.getEmbedding(textA),
      this.getEmbedding(textB)
    ]);
    return this.cosineSim(vecA, vecB);
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
   * 清空缓存
   */
  clearCache() {
    this.cache.clear();
    if (this.models.minimax.client) {
      this.models.minimax.client.clearCache();
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      provider: this.provider,
      cacheSize: this.cache.size,
      model: this.provider === 'minimax' ? this.models.minimax.model : this.models.ollama.model
    };
  }
}

module.exports = EmbeddingManager;
