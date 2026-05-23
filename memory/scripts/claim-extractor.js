/**
 * LLM Claim Extractor — extracts (subject, predicate, object) triplets from atom content
 * Uses MiniMax M2.7 via https
 */

const https = require('https');

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || '';

function callMiniMax({ system, user, messages = [], max_tokens = 1024, thinking = false }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'MiniMax-M2.7',
      max_tokens,
      thinking_enabled: thinking,
      system: system || '',
      messages: [
        ...messages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: user },
      ],
    });
    const options = {
      hostname: 'api.minimaxi.com',
      path: '/anthropic/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-api-key': MINIMAX_API_KEY,
        'anthropic-version': '2023-06-01',
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'error' || parsed.error) {
            reject(new Error(parsed.error?.message || JSON.stringify(parsed)));
            return;
          }
          const textBlock = parsed.content?.find(b => b.type === 'text');
          resolve(textBlock?.text || '');
        } catch (e) {
          reject(new Error(`JSON parse error: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Extract claims triplets from content using MiniMax LLM.
 * Returns array of { subject, predicate, object }
 */
async function extractClaims(content, options = {}) {
  const maxClaims = options.maxClaims || 3;
  const system = `You are a knowledge graph builder. Given a text passage, extract all factual triplets.
Extract 1-${maxClaims} triplet(s) in the format:
SUBJECT | PREDICATE | OBJECT
- SUBJECT: the entity or concept (max 8 words, in Chinese or English as-is)
- PREDICATE: a verb or relation word like CAUSES / SUPPORTS / CONTRADICTS / REFUTES / ENHANCES / MITIGATES / PREVENTS / RESOLVES / SIMILAR_TO / EXTENDS / IMPLEMENTS / USES / FOLLOWS / PRECEDES
- OBJECT: the result or related entity (max 15 words)

Only extract confident factual statements. If uncertain, skip.
Output each triplet on its own line. Use | as separator with spaces around it.
Examples:
小虾 | SUPPORTS | 记忆系统recall优化
仕泽 | 关注 | OpenClaw架构设计
Python | CAUSES | 代码可读性提升`;

  try {
    const response = await callMiniMax({
      system,
      user: `Text:\n${content}`,
      max_tokens: 200,
      thinking: false,
    });

    const lines = response.split('\n').map(l => l.trim()).filter(l => l.includes('|'));
    const claims = [];

    for (const line of lines) {
      const parts = line.split('|').map(p => p.trim());
      if (parts.length >= 3) {
        const subject = parts[0].replace(/^\d+[\.\)]\s*/, '').trim();
        const predicate = parts[1].toUpperCase().trim();
        const object = parts.slice(2).join(' | ').trim();
        if (subject && predicate && object && subject.length < 100 && predicate.length < 30 && object.length < 200) {
          claims.push({ subject, predicate, object });
        }
      }
    }

    return claims.slice(0, maxClaims);
  } catch (e) {
    console.warn('[claim-extractor] extraction failed:', e.message);
    return [];
  }
}

/**
 * Extract causal triplets from code/log content using MiniMax LLM.
 * More structured than general claims — looks for cause-effect chains.
 */
async function extractCausalTriplets(content, options = {}) {
  const system = `You are a causal reasoning engine. Given code or technical content, extract causal relationship triplets.
Extract 1-3 causal chains in the format:
CAUSE | predicate | EFFECT

Predicates to use: CAUSES / MITIGATES / PREVENTS / ENHANCES / FOLLOWS / PRECEDES

Focus on: error -> symptom chains, config -> behavior links, dependency relationships.
Examples:
延迟初始化 | CAUSES | 内存占用过高
Ollama离线 | CAUSES | 向量检索退化为纯关键词
try-catch缺失 | PREVENTS | 错误被吞掉
输出格式：每行 "CAUSE | PREDICATE | EFFECT"，仅输出 triplets.`;

  try {
    const response = await callMiniMax({
      system,
      user: `Code/Content:\n${content.slice(0, 800)}`,
      max_tokens: 150,
      thinking: false,
    });

    const lines = response.split('\n').map(l => l.trim()).filter(l => l.includes('|'));
    const triplets = [];

    for (const line of lines) {
      const parts = line.split('|').map(p => p.trim());
      if (parts.length >= 3) {
        const cause = parts[0].replace(/^\d+[\.\)]\s*/, '').trim();
        const predicate = parts[1].toUpperCase().replace(/[^A-Z_]/g, '').trim();
        const effect = parts.slice(2).join(' | ').trim();
        const validPredicates = ['CAUSES', 'MITIGATES', 'PREVENTS', 'ENHANCES', 'FOLLOWS', 'PRECEDES'];
        if (cause && predicate && effect && validPredicates.includes(predicate)) {
          triplets.push({ subject: cause, predicate, object: effect });
        }
      }
    }

    return triplets.slice(0, 3);
  } catch (e) {
    console.warn('[claim-extractor] causal extraction failed:', e.message);
    return [];
  }
}

module.exports = { extractClaims, extractCausalTriplets, callMiniMax };