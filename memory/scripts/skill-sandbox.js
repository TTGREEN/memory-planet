/**
 * Skill Sandbox — 节点四极轻量沙盒 + Generative TDD
 *
 * 基于 isolated-vm（V8 Isolate），运行 LLM 生成的纯逻辑验证函数。
 *
 * CLI:
 *   node skill-sandbox.js run <code> <input-json>       — run one code+input
 *   node skill-sandbox.js validate <code> <cases-json>   — run TDD with test cases
 *   node skill-sandbox.js generate-tdd <paradigm>        — Generative TDD: matrix+code+RLAIF闭环
 *
 * Module:
 *   const ss = require('./skill-sandbox.js');
 *   ss.runInSandbox(code, input, opts)
 *   ss.runSkillValidation(code, testCases)
 */

'use strict';

const ivm   = require('isolated-vm');
const v8    = require('v8');
const https = require('https');

const SANDBOX_MEMORY_MB = 16;
const TIMEOUT_MS = 50;

// ─── MiniMax API (correct headers: X-Api-Key, not x-api-key) ───────────────

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || '';

function callLLM({ system, user, max_tokens = 512 }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: 'MiniMax-M2.7', max_tokens, system, messages: [{ role: 'user', content: user }] });
    const options = {
      hostname: 'api.minimaxi.com', path: '/anthropic/v1/messages', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-Api-Key': MINIMAX_API_KEY, 'anthropic-version': '2023-06-01' },
      timeout: 15000,
    };
    const req = https.request(options, res => {
      let data = ''; res.on('data', c => data += c); res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) { reject(new Error(parsed.error?.message || JSON.stringify(parsed))); return; }
          resolve(parsed.content?.find(b => b.type === 'text')?.text || '');
        } catch(e) { reject(new Error('parse error: ' + data.slice(0, 200))); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('LLM timeout')); });
    req.on('error', reject); req.write(body); req.end();
  });
}

// ─── Core Sandbox ──────────────────────────────────────────────────────────

async function runInSandbox(code, input, { timeoutMs = TIMEOUT_MS, memoryMb = SANDBOX_MEMORY_MB } = {}) {
  let isolate = null;
  try {
    isolate = new ivm.Isolate({ memory: memoryMb });
    const context = await isolate.createContext();
    const jail = context.global;

    // Block all dangerous globals
    const BANNED = ['fs', 'http', 'https', 'child_process', 'require', 'eval', 'Function',
                    'process', 'GLOBAL', 'window', 'document', 'import', 'export', '_fn', '_result'];
    for (const name of BANNED) {
      await jail.set(name, undefined, { copy: true });
    }

    // Set input data (by-copy, isolated from host)
    await jail.set('_input', input, { copy: true });

    // Build execution code: if code declares _fn, call it with _input and store to _r
    // NOTE: Do NOT pre-set _r from jail side — in strict mode, jail.set creates a global const binding
    // that makes "_r = ..." in the script throw "Assignment to constant variable"
    const hasFn = /^function\s+_fn\b/.test(code) || /\bfunction\s+_fn\b/.test(code);
    const execCode = hasFn
      ? `'use strict';\nvar _r;\n${code}\nif (typeof _fn === 'function') { try { _r = _fn(_input); } catch(e) { _r = 'ERROR:' + e.message; } }`
      : `'use strict';\n${code}`;

    const script = isolate.compileScriptSync(execCode);
    await script.run(context, { timeout: timeoutMs });

    let result;
    try { result = await jail.get('_r', { copy: true }); } catch(e) { result = undefined; }
    return { ok: true, result, error: null, timedOut: false };

  } catch(e) {
    const msg = e.message || String(e);
    return { ok: false, result: null, error: msg, timedOut: msg.includes('timed out') || msg.includes('isolate') };

  } finally {
    if (isolate) { try { isolate.dispose(); } catch(_) {} }
  }
}

// ─── TDD Validation ───────────────────────────────────────────────────────

async function runSkillValidation(code, testCases) {
  const results = [], passed = 0, failed = 0;
  for (const tc of testCases) {
    let exec, status;
    try { exec = await runInSandbox(code, tc.input); } catch(e) { exec = { ok: false, result: null, error: e.message }; }
    try { status = !exec.ok ? (exec.timedOut ? 'timeout' : 'error') : (exec.result === tc.expected ? 'pass' : 'fail'); } catch(e) { status = 'error'; }
    try { if (status === 'pass') passed++; else failed++; } catch(e) { /* increment failed, skip */ }
    try { results.push({ input: tc.input, expected: tc.expected, got: exec.result, status }); } catch(e) { /* push failed */ }
  }
  const rlaifFeedback = failed > 0
    ? `Failed ${failed}/${testCases.length}: ${results.filter(r => r.status !== 'pass').map(r => `expected ${r.expected} got ${r.got}`).join(', ')}.`
    : null;
  return { passed, failed, results, rlaifFeedback };
}

// ─── Generative TDD ────────────────────────────────────────────────────────

async function generateTestMatrix(paradigmText) {
  const raw = await callLLM({
    system: 'You are a skill generation AI. Output ONLY valid JSON: {"test_cases": [{"input": "...", "expected": "pass|fail"}, ...]}.',
    user: `Paradigm: ${paradigmText}\n\nGenerate 4-6 adversarial test cases in JSON format.`,
  });
  const jsonStart = raw.indexOf('{');
  const jsonEnd = raw.lastIndexOf('}') + 1;
  if (jsonStart < 0 || jsonEnd <= jsonStart) { return null; }
  try {
    return JSON.parse(raw.slice(jsonStart, jsonEnd));
  } catch(e) {
    // Try to find partial valid JSON around the error point
    console.error('[generateTestMatrix] JSON parse error:', e.message);
    console.error('[generateTestMatrix] Raw response:', raw.slice(0, 500));
    return null;
  }
}

async function generateCodeFromParadigm(paradigmText, testMatrix, errorFeedback = '') {
  const system = `You are a skill generation AI embedded in Memory Planet.
Given a paradigm and a test matrix, generate a JavaScript validation function.

Rules:
- Function signature: function _fn(input) { ... return true_or_false; }
- Do NOT use arrow functions or const/let/var for _fn
- ONLY use: Array, String, Number, Boolean, Object, JSON, Math
- ABSOLUTELY FORBIDDEN: fs, http, child_process, require, eval, Function, import, export

Paradigm: ${paradigmText}
${errorFeedback ? `Previous attempt failed: ${errorFeedback}` : ''}

Output ONLY the JavaScript code (no markdown, no explanation).`.trim();

  const raw = await callLLM({ system, user: `Test matrix: ${JSON.stringify(testMatrix)}\n\nGenerate the _fn function:`, max_tokens: 512 });
  const fnStart = raw.indexOf('function');
  return fnStart >= 0 ? raw.slice(fnStart).trim() : null;
}

// ─── Export ───────────────────────────────────────────────────────────────

module.exports = { runInSandbox, runSkillValidation, generateTestMatrix, generateCodeFromParadigm };

// ─── CLI ─────────────────────────────────────────────────────────────────

const cmd = process.argv[2];

if (cmd === 'run') {
  const code = process.argv[3] || 'function _fn(x) { return x.value > 0; }';
  const input = JSON.parse(process.argv[4] || '{"value": 42}');
  runInSandbox(code, input).then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(r.ok ? 0 : 1); }).catch(e => { console.error(e.message); process.exit(1); });

} else if (cmd === 'validate') {
  const code = process.argv[3] || 'function _fn(x) { return x.score > 0.5; }';
  const cases = JSON.parse(process.argv[4] || '[{"input":{"score":0.8},"expected":true}]');
  runSkillValidation(code, cases).then(r => {
    console.log(`Passed: ${r.passed}/${r.results.length}, Failed: ${r.failed}`);
    if (r.rlaifFeedback) console.log('RLAIF:', r.rlaifFeedback);
    else console.log('All tests passed!');
    process.exit(r.passed === r.results.length ? 0 : 1);
  }).catch(e => { console.error(e.message); process.exit(1); });

} else if (cmd === 'generate-tdd') {
  const paradigm = process.argv[3] || 'Entropy-driven systems should prioritize high-variance memories in recall';
  const MAX_RETRIES = 3;

  (async () => {
    console.log(`[Generative TDD] Paradigm: "${paradigm}"`);
    const matrix = await generateTestMatrix(paradigm);
    if (!matrix) { console.error('[Generative TDD] Matrix generation failed'); process.exit(1); }
    console.log('[Generative TDD] Matrix:', JSON.stringify(matrix).slice(0, 300));

    let code = await generateCodeFromParadigm(paradigm, matrix);
    if (!code) { console.error('[Generative TDD] Code generation failed'); process.exit(1); }

    let attempt = 0, passed = false;
    for (attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const exec = await runInSandbox(code, matrix.test_cases);
      const results = [];
      for (const tc of matrix.test_cases) {
        const status = !exec.ok ? 'fail' : (exec.result === tc.expected ? 'pass' : 'fail');
        results.push({ input: tc.input, expected: tc.expected, got: exec.result, status });
      }
      const passCount = results.filter(r => r.status === 'pass').length;
      console.log(`[Generative TDD] Attempt ${attempt}: ${passCount}/${matrix.test_cases.length} passed`);
      if (passCount === matrix.test_cases.length) { passed = true; break; }
      const failures = results.filter(r => r.status !== 'pass');
      const feedback = failures.map(f => `"${JSON.stringify(f.input)}" expected ${f.expected} got ${JSON.stringify(f.got)}`).join('; ');
      const newCode = await generateCodeFromParadigm(paradigm, matrix, feedback);
      if (newCode) code = newCode;
    }

    console.log(passed ? `\n[Generative TDD] SUCCESS after ${attempt} attempts!` : `\n[Generative TDD] FAILED after ${MAX_RETRIES} attempts`);
    process.exit(passed ? 0 : 1);
  })().catch(e => { console.error(e.message); process.exit(1); });

} else if (require.main && require.main.filename === __filename) {
  (async () => {
    console.log('=== Skill Sandbox Demo ===\n');
    const code1 = 'function _fn(atom) { return atom.importance >= 0.8 && atom.recency > 0.5; }';
    const cases1 = [
      { input: { importance: 0.9, recency: 0.8 }, expected: true },
      { input: { importance: 0.3, recency: 0.9 }, expected: false },
      { input: { importance: 0.85, recency: 0.3 }, expected: false },
    ];
    const r1 = await runSkillValidation(code1, cases1);
    console.log('Paradigm: "High importance memory should rank higher in recall"');
    console.log(`Result: ${r1.passed} passed, ${r1.failed} failed`);
    if (r1.rlaifFeedback) console.log('RLAIF:', r1.rlaifFeedback);
    else console.log('All tests passed!');

    const r2 = await runInSandbox('function _fn(x) { while(true) {} }', { value: 1 });
    console.log('\nInfinite loop test → timedOut:', r2.timedOut);

    const r3 = await runInSandbox('function _fn() { return fs.readFileSync("/etc/passwd"); }', {});
    console.log('fs access test → ok:', r3.ok, '| error:', r3.error?.slice(0, 60));
    console.log('\n=== All demos complete ===');
  })().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
}