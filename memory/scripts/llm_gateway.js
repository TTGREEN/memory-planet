/**
 * llm_gateway.js — 统一 LLM 适配器（端云协同认知操作系统）
 *
 * 使用原生 https 调用 MiniMax Anthropic API（兼容任何 OpenAI-compatible endpoint）
 * 通过 .env 配置：LLM_BASE_URL / LLM_API_KEY / LLM_MODEL_NAME
 * 零外部依赖（无 openai SDK）
 *
 * 本地embedding：mxbai-embed-large（Ollama，已就绪）
 * 云端推理：MiniMax（Anthropic /v1/messages API）
 *
 * 设计原则：
 * - 本地只做embedding存储和向量检索（低成本、低延迟）
 * - 云端只做高维度语义判断（Skeptic Prompt，按需调用）
 * - .env配置确保换模型零代码改动
 */

'use strict';

const https = require('https');

// ─── 配置读取 ────────────────────────────────────────────────────────────────

function loadEnv() {
  try {
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(__dirname, '..', '..', '.env');
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
      const env = {};
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const [key, ...vals] = trimmed.split('=');
        if (key && vals.length) env[key.trim()] = vals.join('=').trim();
      }
      return env;
    }
  } catch(e) { /* ignore */ }
  return {};
}

const env = loadEnv();

const LLM_BASE_URL    = process.env.LLM_BASE_URL    || 'https://api.minimaxi.com/anthropic/v1';
const LLM_API_KEY     = process.env.LLM_API_KEY     || env.LLM_API_KEY     || '';
const LLM_MODEL_NAME  = process.env.LLM_MODEL_NAME  || 'MiniMax-M2.7';
const LLM_TIMEOUT_MS  = parseInt(process.env.LLM_TIMEOUT_MS || '30000', 10);

// MiniMax 使用 Anthropic /v1/messages 格式（不是 OpenAI /chat/completions）
const IS_ANTHROPIC_API = !LLM_BASE_URL.includes('openai.com');

// ─── MiniMax兼容请求 ─────────────────────────────────────────────────────────

function buildAnthropicPayload(model, messages, temperature = 0.1) {
  // Anthropic Messages API 格式
  return JSON.stringify({
    model: model,
    messages: messages,
    temperature: temperature,
    max_tokens: 512,
  });
}

function buildHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + apiKey,
    'anthropic-version': '2023-06-01',
  };
}

function parseAnthropicResponse(responseBody) {
  try {
    const parsed = JSON.parse(responseBody);
    if (parsed.type === 'message' && parsed.content && parsed.content[0]) {
      // Anthropic message format
      if (parsed.content[0].type === 'output_text') {
        return parsed.content[0].text.trim();
      }
      // Thinking block
      if (parsed.content[0].type === 'thinking') {
        // Strip thinking, return actual response if available
        const textContent = parsed.content.find(c => c.type === 'output_text');
        return textContent ? textContent.text.trim() : parsed.content[0].thinking.slice(0, 100);
      }
    }
    return typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
  } catch(e) {
    return responseBody.trim();
  }
}

/**
 * 通用的 chat 请求（MiniMax Anthropic 格式）
 */
function chatRequest(messages, modelName) {
  return new Promise((resolve, reject) => {
    if (!LLM_API_KEY) {
      reject(new Error('LLM_API_KEY not configured'));
      return;
    }

    const payload = buildAnthropicPayload(modelName, messages, 0.1);
    const endpoint = LLM_BASE_URL + '/messages';
    const url = new URL(endpoint);

    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: buildHeaders(LLM_API_KEY),
      timeout: LLM_TIMEOUT_MS,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parseAnthropicResponse(data));
        } else {
          reject(new Error('LLM API error ' + res.statusCode + ': ' + data.slice(0, 300)));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('LLM API timeout after ' + LLM_TIMEOUT_MS + 'ms'));
    });

    req.on('error', (e) => {
      reject(new Error('LLM API connection error: ' + e.message));
    });

    req.write(payload);
    req.end();
  });
}

// ─── Skeptic 二元判定 ─────────────────────────────────────────────────────────

const SKEPTIC_SYSTEM_PROMPT = 'You are a strict Skeptic judge. Output ONLY one word: TRUE or FALSE. Nothing else.';

/**
 * Skeptic 二元判定（防呆层）
 * @param {string} newConcept - 新提交的atom内容
 * @param {string} existingConcept - 已有atom内容
 * @returns {Promise<boolean>} true=冲突，false=不冲突
 */
async function askSkeptic(newConcept, existingConcept) {
  if (!LLM_API_KEY) {
    console.warn('[llm_gateway] LLM_API_KEY not set, skipping Skeptic check');
    return false;
  }

  // 强制单行输出约束，中文语境
  const prompt = `判断以下两段知识是否互斥。互斥输出TRUE，不互斥输出FALSE。只输出单词，不要解释。

A: ${newConcept.slice(0, 300)}

B: ${existingConcept.slice(0, 300)}

答案：`;

  try {
    const result = await chatRequest([
      { role: 'system', content: SKEPTIC_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ], LLM_MODEL_NAME);

    const raw = result.toUpperCase();
    const verdict = (raw.includes('TRUE') && !raw.includes('FALSE')) ? 'TRUE' :
                    (raw.includes('FALSE') && !raw.includes('TRUE')) ? 'FALSE' : 'AMBIGUOUS';
    if (verdict === 'TRUE') {
      return true;
    } else {
      return false;
    }
  } catch(e) {
    // 云端故障，降级策略：不锁死系统
    console.warn('[llm_gateway] Cloud Skeptic failed, fallback to no-conflict:', e.message);
    return false;
  }
}

/**
 * 测试连通性
 */
async function ping() {
  if (!LLM_API_KEY) return { ok: false, reason: 'no API key configured' };
  try {
    const result = await chatRequest([
      { role: 'user', content: 'Say "OK" in one word.' }
    ], LLM_MODEL_NAME);
    const ok = result.toUpperCase().includes('OK');
    return { ok, response: result.slice(0, 50) };
  } catch(e) {
    return { ok: false, reason: e.message };
  }
}

// ─── 导出 ─────────────────────────────────────────────────────────────────────

module.exports = {
  askSkeptic,
  ping,
  // 暴露配置供外部查询
  config: {
    baseUrl: LLM_BASE_URL,
    model: LLM_MODEL_NAME,
    hasApiKey: !!LLM_API_KEY,
    isAnthropicApi: IS_ANTHROPIC_API,
  },
};