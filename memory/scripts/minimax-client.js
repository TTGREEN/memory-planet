/**
 * MiniMax API Client (Anthropic-compatible format)
 * Base URL: https://api.minimaxi.com/anthropic
 * Model: MiniMax-M2.7
 */

const https = require('https');

const MINIMAX_BASE_URL = 'api.minimaxi.com';
const MINIMAX_API_PATH = '/anthropic/v1/messages';
const MODEL = 'MiniMax-M2.7';

/**
 * Call MiniMax M2.7 chat completion.
 * Uses Anthropic API format.
 *
 * @param {Object} opts
 * @param {string}   opts.system      - system prompt
 * @param {string}   opts.user         - user message
 * @param {string[]} [opts.messages]  - prior conversation messages [{role, content}]
 * @param {number}   [opts.max_tokens] - max output tokens (default 1024)
 * @param {boolean}  [opts.thinking]   - enable extended thinking (default false)
 * @returns {Promise<string>} assistant text response
 */
function callMiniMax({ system, user, messages = [], max_tokens = 1024, thinking = false }) {
  return new Promise((resolve, reject) => {
    const body = {
      model: MODEL,
      max_tokens,
      system: system || 'You are a helpful AI assistant.',
      messages: [
        ...messages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: user },
      ],
    };
    // Only set thinking_enabled when explicitly true —
    // sending false or omitting causes MiniMax to behave differently
    if (thinking) body.thinking_enabled = true;

    const bodyStr = JSON.stringify(body);
    const options = {
      hostname: MINIMAX_BASE_URL,
      path: MINIMAX_API_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        'x-api-key': process.env.MINIMAX_API_KEY || '',
        'anthropic-version': '2023-06-01',
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'error' || parsed.error) {
            reject(new Error(parsed.error?.message || JSON.stringify(parsed)));
            return;
          }
          // Support both text block and thinking block response
          const textBlock = parsed.content?.find(b => b.type === 'text');
          resolve(textBlock?.text || '');
        } catch(e) {
          reject(new Error(`JSON parse error: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

/**
 * Judge whether two atoms are truly contradictory in the same context.
 * Uses MiniMax-M2.7 as LLM-as-a-Judge.
 *
 * @param {string} atom1Content
 * @param {string} atom2Content
 * @returns {Promise<boolean>} true = real contradiction, false = false positive
 */
async function judgeContradictionWithLLM(atom1Content, atom2Content) {
  const system = 'You are a logical contradiction detector. Output EXACTLY one word: TRUE or FALSE. TRUE = genuine contradiction in same context. FALSE = unrelated or different contexts. Never explain.';

  const user = `Statement A: ${atom1Content}

Statement B: ${atom2Content}`;

  try {
    // Use higher max_tokens and search for TRUE/FALSE pattern in response
    // Model may output TRUE/FALSE followed by punctuation or newlines
    const response = await callMiniMax({ system, user, max_tokens: 200, thinking: false });
    const normalized = response.trim().toUpperCase();
    if (normalized === 'TRUE') return true;
    if (normalized === 'FALSE') return false;
    // Match TRUE/FALSE as a word, possibly followed by punctuation
    if (/^TRUE\W/.test(normalized) || /\bTRUE\b/.test(normalized)) return true;
    if (/^FALSE\W/.test(normalized) || /\bFALSE\b/.test(normalized)) return false;
    // Chinese patterns
    if (/矛盾|互相?对立|冲突/.test(response)) return true;
    return false;
  } catch(e) {
    console.error('[MiniMax] judgeContradiction failed:', e.message);
    return false;
  }
}

/**
 * Generate paradigm shift conclusion from conflicting atoms.
 * Uses MiniMax-M2.7 for first-principles reasoning.
 *
 * @param {Object} conflictInfo - { subject, atoms: [{content, relation_type}], conflictDescription }
 * @returns {Promise<string>} paradigm shift principle
 */
async function generateParadigmShift(conflictInfo) {
  const { subject, atoms, conflictDescription } = conflictInfo;

  const system = `You are a cognitive architecture AI embedded in a Memory Planet system.
You have detected high local cognitive entropy — conflicting knowledge atoms
in the same subject domain.

Your task: perform Hegelian dialectical synthesis (正反合).
Given contradictory positions (正 and 反), derive a higher-order principle (合)
that transcends and unifies them.

Output ONE concise principle in Chinese or English (max 100 characters).
The principle should be actionable and architecturally meaningful.
Do not explain your reasoning. Only output the principle.`;

  const atomsText = atoms.map((a, i) =>
    `Conflicting Claim ${i + 1} (${a.relation_type}): ${a.content}`
  ).join('\n');

  const user = `Subject Domain: ${subject}

Conflicting Claims:
${atomsText}

Conflict Description: ${conflictDescription || 'Multiple contradictory approaches detected'}

Derive the unifying principle (合):`;

  try {
    const response = await callMiniMax({
      system,
      user,
      max_tokens: 600,
      thinking: true,
    });
    if (!response || !response.trim()) {
      console.warn('[MiniMax] generateParadigmShift: empty response, increasing tokens...');
      const fallback = await callMiniMax({ system, user, max_tokens: 800, thinking: false });
      return fallback.trim();
    }
    return response.trim();
  } catch(e) {
    console.error('[MiniMax] generateParadigmShift failed:', e.message);
    return null;
  }
}

module.exports = {
  callMiniMax,
  judgeContradictionWithLLM,
  generateParadigmShift,
  MINIMAX_BASE_URL,
  MODEL,
};
