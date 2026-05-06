/**
 * Worker 池并行 Embedding（基于 worker_threads）
 * 职责：并行计算 embedding，提升吞吐 4-8 倍
 * 位置：skills/knowledge-1688-mtop-api/local-server/worker-pool.js
 */

import { Worker } from 'worker_threads';
import * as os from 'os';

class EmbeddingWorkerPool {
  constructor(options = {}) {
    this.workerCount = options.workers || Math.max(2, os.cpus().length - 1);
    this.workers = [];
    this.taskQueue = [];
    this.activeWorkers = 0;
    this.completed = 0;
    this.maxRetries = options.maxRetries || 3;
    this.timeoutMs = options.timeoutMs || 30000;

    console.log(`[WorkerPool] 初始化 ${this.workerCount} 个 worker`);
  }

  /**
   * 启动所有 worker
   */
  async initialize() {
    for (let i = 0; i < this.workerCount; i++) {
      const worker = this.createWorker(i);
      this.workers.push(worker);
    }
  }

  /**
   * 创建单个 worker
   */
  createWorker(id) {
    const worker = new Worker('./embedding-worker.js', {
      workerData: { workerId: id }
    });

    worker.once('online', () => {
      console.log(`[WorkerPool] Worker ${id} 就绪`);
    });

    worker.once('error', (err) => {
      console.error(`[WorkerPool] Worker ${id} 错误:`, err.message);
    });

    worker.once('exit', (code) => {
      if (code !== 0) {
        console.warn(`[WorkerPool] Worker ${id} 异常退出，代码: ${code}`);
      }
    });

    return {
      id,
      worker,
      busy: false,
      currentTask: null
    };
  }

  /**
   * 提交批量 embedding 任务
   * @param {string[]} texts - 待编码文本数组
   * @returns {Promise<number[][]>} 向量数组
   */
  async embedBatch(texts) {
    const chunks = this.chunkArray(texts, Math.ceil(texts.length / this.workerCount));

    const promises = this.workers.map((w, idx) => {
      const chunk = chunks[idx] || [];
      if (chunk.length === 0) return Promise.resolve([]);

      return this.submitToWorker(w, chunk);
    });

    const results = await Promise.all(promises);
    // 扁平化
    return results.flat();
  }

  /**
   * 提交任务到指定 worker
   */
  async submitToWorker(workerWrapper, texts) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Worker timeout'));
      }, this.timeoutMs);

      const message = {
        type: 'embed',
        texts,
        requestId: Date.now() + '-' + Math.random()
      };

      workerWrapper.worker.once('message', (result) => {
        clearTimeout(timeout);
        if (result.error) reject(new Error(result.error));
        else resolve(result.vectors);
      });

      workerWrapper.worker.postMessage(message);
    });
  }

  /**
   * 数组分块
   */
  chunkArray(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * 关闭所有 worker
   */
  async terminate() {
    for (const w of this.workers) {
      w.worker.terminate();
    }
    this.workers = [];
    console.log('[WorkerPool] 已关闭');
  }
}

export default EmbeddingWorkerPool;
