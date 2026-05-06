/**
 * Embedding Worker（独立线程）
 * 职责：接收文本列表，调用 MiniMax API 计算 embedding
 */

import { parentPort, workerData } from 'worker_threads';

const OLLAMA_URL = 'http://localhost:11434/api/embeddings';
const MODEL = 'nomic-embed-text';

/**
 * 生成 embedding 向量
 */
async function generateEmbedding(text) {
  const timeoutMs = 30000;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; }, timeoutMs);

  try {
    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt: text })
    });
    clearTimeout(timeout);
    if (timedOut) throw new Error('Request timeout');
    if (!response.ok) throw new Error(`Ollama error: ${response.status}`);
    const data = await response.json();
    return data.embedding;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 批量处理
 */
async function processBatch(texts) {
  const vectors = [];
  for (const text of texts) {
    try {
      const vec = await generateEmbedding(text);
      vectors.push(vec);
    } catch (err) {
      console.error(`[Worker ${workerData.workerId}] Failed:`, err.message);
      vectors.push(null); // 占位
    }
  }
  return vectors;
}

// 主消息循环
parentPort.once('message', async (msg) => {
  if (msg.type === 'embed') {
    try {
      const vectors = await processBatch(msg.texts);
      parentPort.postMessage({
        requestId: msg.requestId,
        vectors
      });
    } catch (err) {
      parentPort.postMessage({
        requestId: msg.requestId,
        error: err.message
      });
    }
  }

  // 完成后退出（避免驻留）
  setTimeout(() => process.exit(0), 1000);
});
