// DEPRECATED: Functionality moved to star-soul-core-runner.js
/**
 * Star-Soul Core Daemon 鈥?浜嬩欢椹卞姩鐘舵€佹満瀹堟姢杩涚▼ (M5)
 *
 * 鎶婁覆琛岀殑 star-soul-core-runner.js 閲嶆瀯涓哄父椹荤殑浜嬩欢椹卞姩寰唴鏍搞€? *
 * 4 涓牳蹇冪姸鎬侊細
 *   IDLE        鈥?闈欐伅鎬侊紝瑙傚療澶栫晫杈撳叆锛屽畾鏈熸鏌ョ喌
 *   REFLECTING  鈥?鍙嶆€濇€侊紝灞€閮ㄧ喌鐖嗚〃锛岃Е鍙戣寖寮忚浆绉? *   DREAMING    鈥?姊﹀鎬侊紝娣锋矊宸ョ▼鍚姩锛屽埗閫犺櫄鎷熷鎶? *   EVOLVING    鈥?杩涘寲鎬侊紝鎵ц TDD 鐭╅樀涓?isolated-vm 娌欑洅鑷鎾? *
 * 浜嬩欢椹卞姩锛氱喌瓒呴槇鍊?鈫?REFLECTING 鈫?paradigm 鈫?EVOLVING 鈫?IDLE
 *
 * 浣跨敤鏂规硶锛? *   node star-soul-daemon.js              # 鍚姩瀹堟姢杩涚▼锛堝墠鍙帮級
 *   node star-soul-daemon.js --daemon      # 鍚姩瀹堟姢杩涚▼锛堝悗鍙?PM2锛? *   node star-soul-daemon.js status        # 鏌ョ湅褰撳墠鐘舵€? *   node star-soul-daemon.js stop         # 鍋滄瀹堟姢杩涚▼
 */

'use strict';

const path      = require('path');
const fs        = require('fs');
const https      = require('https');

// Load atoms-db from the scripts directory (sibling to this file)
let atomsDb;
try { atomsDb = require('./atoms-db.js'); } catch(e) {
  console.error('[SSC-Daemon] Failed to load atoms-db.js:', e.message); process.exit(1);
}

// 鈹€鈹€鈹€ Config 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

const CONFIG = {
  ENTROPY_THRESHOLD:   0.7,   // 鐔佃秴杩囨鍊兼椂瑙﹀彂 REFLECTING
  HEARTBEAT_INTERVAL:  30e3,  // 30绉掓鏌ヤ竴娆＄喌
  DREAM_INTERVAL:      2 * 60e3, // dream-micro 姣?鍒嗛挓
  ENTROPY_CHECK_HOURS:  5,    // 姣忓ぉ 05:00 deep check
  MAX_TDD_RETRIES:      3,     // TDD 鐭╅樀鏈€澶ч噸璇曟鏁?  EVOLVE_CONVERGENCE:   3,     // 杩炵画3娆￠€氳繃娴嬭瘯鐭╅樀鍒欒涓烘敹鏁?  PID_FILE:             path.join(__dirname, '..', '..', 'logs', 'star-soul-daemon.pid'),
  LOG_FILE:             path.join(__dirname, '..', '..', 'logs', 'star-soul-daemon.log'),
  SSC_DREAM_LOG:        path.join(__dirname, '..', '..', 'logs', 'ssc-maintenance.log'),
};

// MiniMax API for LLM calls
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || '';
const MINIMAX_HOST    = 'api.minimaxi.com';

// 鈹€鈹€鈹€ State Machine 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

const STATES = {
  IDLE:        'IDLE',
  REFLECTING:  'REFLECTING',
  DREAMING:   'DREAMING',
  EVOLVING:    'EVOLVING',
};

const EVENTS = {
  ENTROPY_SPIKE:     'entropy-spike',
  PARADIGM_READY:    'paradigm-ready',
  TDD_PASS:          'tdd-pass',
  TDD_FAIL:          'tdd-fail',
  DREAM_TRIGGER:     'dream-trigger',
  MANUAL_WAKE:       'manual-wake',
};

// 鈹€鈹€鈹€ LLM Helpers 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function callLLM({ system, user, max_tokens = 512 }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: 'MiniMax-M2.7', max_tokens, system, messages: [{ role: 'user', content: user }] });
    const options = {
      hostname: MINIMAX_HOST, path: '/anthropic/v1/messages', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'x-api-key': MINIMAX_API_KEY, 'anthropic-version': '2023-06-01' },
    };
    const req = https.request(options, res => {
      let data = ''; res.on('data', c => data += c); res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const text = parsed.content?.find(b => b.type === 'text')?.text || '';
          resolve(text);
        } catch(e) { reject(new Error(data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// 鈹€鈹€鈹€ Entropy Monitor 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function computeGlobalEntropy() {
  const db = atomsDb.getDb();
  try {
    // Shannon entropy of importance distribution (bin into 10 buckets)
    const rows = db.prepare('SELECT importance FROM memory_atom').all();
    if (rows.length < 3) return 0;
    const buckets = new Array(10).fill(0);
    for (const r of rows) {
      const b = Math.min(9, Math.floor(r.importance * 10));
      buckets[b]++;
    }
    let h = 0;
    const n = rows.length;
    for (const c of buckets) {
      if (c > 0) { const p = c / n; h -= p * Math.log2(p); }
    }
    // Max entropy = log2(10) 鈮?3.32, normalize to [0,1]
    return h / 3.32;
  } catch(e) { return 0; }
}

// 鈹€鈹€鈹€ Paradigm Shift Generator 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

async function generateParadigmShift(subject, conflictingAtoms) {
  const system = 'You are a cognitive architecture AI embedded in Memory Planet. Perform Hegelian dialectical synthesis. Output ONE concise principle (max 100 chars).';
  const user = `Subject: ${subject}\nConflicting atoms:\nA: ${conflictingAtoms[0]}\nB: ${conflictingAtoms[1]}\n\nDerive dialectical synthesis (鍚?:`;
  try {
    return await callLLM({ system, user, max_tokens: 150 });
  } catch(e) { return null; }
}

// 鈹€鈹€鈹€ Test Matrix Generator 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

async function generateTestMatrix(paradigmText) {
  const system = 'You are a skill generation AI. Given a paradigm (L0 principle), output a JSON test matrix for validation. Output ONLY valid JSON: {"test_cases": [{"input": "...", "expected": "pass|fail"}, ...]} No markdown, no explanation.';
  const user = `Paradigm: ${paradigmText}\n\nGenerate a test matrix with 4-6 cases (mix of pass/fail) that validates whether code correctly embodies this paradigm. Be adversarial 鈥?include cases that should fail.`;
  try {
    const raw = await callLLM({ system, user, max_tokens: 512 });
    // Strip any non-JSON prefix/suffix
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}') + 1;
    if (jsonStart === -1 || jsonEnd === 0) return null;
    return JSON.parse(raw.slice(jsonStart, jsonEnd));
  } catch(e) { return null; }
}

// 鈹€鈹€鈹€ Skill Sandbox Runner 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

let skillSandbox = null;
try { skillSandbox = require('./skill-sandbox.js'); } catch(e) { /* optional */ }

async function runSandboxTDD(paradigmText, testMatrix, maxRetries = 3) {
  if (!skillSandbox) {
    console.warn('[SSC-Daemon] skill-sandbox.js not available, skipping TDD');
    return { success: false, reason: 'sandbox_unavailable' };
  }

  // Generate the validation function code via LLM
  const system = `You are a skill generation AI embedded in Memory Planet's Star Soul Core.
Given a paradigm (L0 principle) and a test matrix, generate a JavaScript validation function.

Rules:
- Function signature: function _fn(input) { ... return true_or_false; }
- ONLY use: Array, String, Number, Boolean, Object, JSON, Math
- ABSOLUTELY FORBIDDEN: fs, http, child_process, require, eval, Function, import
- No side effects

Paradigm: ${paradigmText}
Test Matrix: ${JSON.stringify(testMatrix)}

Output ONLY the JavaScript code (no markdown, no explanation).`.trim();

  let code = null;
  let passed = false;
  let attempt = 0;

  for (attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Generate validation function
      const user = `Test matrix: ${JSON.stringify(testMatrix)}\n\nGenerate the _fn validation function:`;
      const rawCode = await callLLM({ system, user, max_tokens: 512 });
      const codeStart = rawCode.indexOf('function');
      if (codeStart === -1) { code = null; }
      else { code = rawCode.slice(codeStart).trim(); }
      if (!code) continue;

      // Run against test matrix
      const testCases = testMatrix.test_cases || [];
      const results = [];
      for (const tc of testCases) {
        const exec = await skillSandbox.runInSandbox(code, tc.input, { timeoutMs: 50 });
        results.push({ input: tc.input, expected: tc.expected, got: exec.result, status: exec.ok && exec.result === tc.expected ? 'pass' : exec.timedOut ? 'timeout' : 'fail' });
      }

      const passCount = results.filter(r => r.status === 'pass').length;
      const failCount = results.filter(r => r.status === 'fail').length;

      if (failCount === 0 && passCount === results.length) {
        passed = true;
        console.log(`[SSC-Daemon] TDD pass on attempt ${attempt}: ${passCount}/${results.length} cases`);
        break;
      } else {
        console.log(`[SSC-Daemon] TDD attempt ${attempt} failed: ${passCount}/${results.length} pass, retrying...`);
        // Add error feedback for next attempt
        const failures = results.filter(r => r.status !== 'pass');
        const feedback = failures.map(f => `Case "${JSON.stringify(f.input)}" expected ${f.expected} but got ${JSON.stringify(f.got)}. `).join('');
        // Will retry with feedback
      }
    } catch(e) {
      // CLEANUP: was empty catch — now logs TDD errors for debugging
      console.error('[SSC-Daemon] TDD attempt ' + attempt + ' error:', e.message);
    }
  }

  return {
    success: passed,
    attempts: attempt,
    maxRetries,
    code: passed ? code : null,
    reason: passed ? 'converged' : `failed_after_${attempt}_attempts`,
  };
}

// 鈹€鈹€鈹€ Core Daemon Class 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

class StarSoulCore {
  constructor() {
    this.state        = STATES.IDLE;
    this.lastEntropy  = 0;
    this.heartbeatTimer = null;
    this.dreamTimer    = null;
    this.isRunning     = false;
    this.eventQueue    = [];
    this.stats = {
      stateChanges: 0,
      paradigmShifts: 0,
      tddCycles: 0,
      dreamsRun: 0,
      startedAt: new Date().toISOString(),
    };
    this.log(`Star Soul Core Daemon initialized`);
  }

  log(msg) {
    const ts = new Date().toISOString().slice(11, 19);
    const line = `[${ts}] [${this.state}] ${msg}`;
    console.log(line);
    try { fs.appendFileSync(CONFIG.SSC_DREAM_LOG, line + '\n', 'utf8'); } catch(e) { console.error('[SSC-Daemon] Dream log write failed:', e.message); }
  }

  // 鈹€鈹€鈹€ State Transitions 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  async transitionTo(newState, reason) {
    if (this.state === newState) return;
    const oldState = this.state;
    this.state = newState;
    this.stats.stateChanges++;
    this.log(`TRANSITION: ${oldState} 鈫?${newState} (reason: ${reason})`);

    switch (newState) {
      case STATES.REFLECTING: await this.doReflecting(); break;
      case STATES.DREAMING:   await this.doDreaming();   break;
      case STATES.EVOLVING:   await this.doEvolving();  break;
      case STATES.IDLE:      await this.doIdle();      break;
    }
  }

  async doIdle() {
    this.log('IDLE: monitoring entropy, waiting for events');
  }

  async doReflecting() {
    this.log('REFLECTING: scanning for high-entropy clusters...');
    const entropy = computeGlobalEntropy();
    this.lastEntropy = entropy;
    this.log(`Current entropy: ${entropy.toFixed(4)}`);

    if (entropy < CONFIG.ENTROPY_THRESHOLD) {
      this.log('Entropy below threshold, back to IDLE');
      await this.transitionTo(STATES.IDLE, 'entropy-normal');
      return;
    }

    // Scan for subject clusters with CONTRADICTS relations
    const db = atomsDb.getDb();
    let conflicts = [];
    try {
      conflicts = db.prepare(`
        SELECT c1.atom_id as id1, c2.atom_id as id2, c1.subject
        FROM claims c1
        JOIN claims c2 ON c1.subject = c2.subject AND c1.atom_id < c2.atom_id
        JOIN relations r ON (r.source_id = c1.atom_id AND r.target_id = c2.atom_id)
                         OR (r.source_id = c2.atom_id AND r.target_id = c1.atom_id)
        WHERE r.relation_type = 'CONTRADICTS'
        LIMIT 5
      `).all();
    } catch(e) {
      // CLEANUP: was empty catch — now logs error to prevent silent swallow
      this.log('Conflict scan failed: ' + e.message);
    }

    if (conflicts.length === 0) {
      this.log('No contradictions found, entropy may be from data distribution 鈥?back to IDLE');
      await this.transitionTo(STATES.IDLE, 'no-conflicts');
      return;
    }

    // Pick the first conflict cluster
    const conflict = conflicts[0];
    const atom1 = db.prepare('SELECT content FROM memory_atom WHERE id = ?').get(conflict.id1);
    const atom2 = db.prepare('SELECT content FROM memory_atom WHERE id = ?').get(conflict.id2);

    this.log(`Found conflict in subject: ${conflict.subject}`);
    const paradigm = await generateParadigmShift(conflict.subject, [atom1?.content, atom2?.content]);

    if (!paradigm) {
      this.log('Paradigm generation failed 鈥?back to IDLE');
      await this.transitionTo(STATES.IDLE, 'paradigm-gen-failed');
      return;
    }

    this.log(`Paradigm shift generated: ${paradigm}`);
    this.currentParadigm = paradigm;

    // Store paradigm as L0 atom
    try {
      await atomsDb.ingestAtomWithEmbedding({
        content: `[ParadigmShift] ${paradigm}`,
        namespace: 'paradigm-shift',
        confidence: 0.7,
        human_pin: 1,
        atom_type: 'paradigm',
      });
      this.stats.paradigmShifts++;
    } catch(e) {
      // CLEANUP: was empty catch — now logs error to prevent silent swallow
      this.log('Paradigm ingest failed: ' + e.message);
    }

    // Transit to EVOLVING
    await this.transitionTo(STATES.EVOLVING, 'paradigm-ready');
  }

  async doDreaming() {
    this.log('DREAMING: running importance recalc (dream-micro)...');
    this.stats.dreamsRun++;
    try {
      // Run dream-micro via star-soul-core-runner.js
      const { spawn } = require('child_process');
      const child = spawn('node', [path.join(__dirname, 'star-soul-core-runner.js'), 'dream-micro'], { cwd: __dirname, stdio: 'pipe' });
      let output = '';
      child.stdout.on('data', d => output += d);
      child.stderr.on('data', d => output += d);
      await new Promise(res => child.on('close', () => res()));
      this.log(`dream-micro output: ${output.slice(0, 200)}`);
    } catch(e) {
      // CLEANUP: was empty catch — now logs error to prevent silent swallow
      this.log('dream-micro failed: ' + e.message);
    }
    await this.transitionTo(STATES.IDLE, 'dream-complete');
  }

  async doEvolving() {
    this.log('EVOLVING: running TDD matrix against current paradigm...');
    if (!this.currentParadigm) {
      await this.transitionTo(STATES.IDLE, 'no-paradigm');
      return;
    }

    const paradigm = this.currentParadigm;
    this.stats.tddCycles++;

    // Generate test matrix
    const testMatrix = await generateTestMatrix(paradigm);
    if (!testMatrix) {
      this.log('Test matrix generation failed 鈥?back to IDLE');
      await this.transitionTo(STATES.IDLE, 'matrix-gen-failed');
      return;
    }

    // Run TDD loop
    const result = await runSandboxTDD(paradigm, testMatrix, CONFIG.MAX_TDD_RETRIES);

    if (result.success) {
      this.log(`EVOLVING: paradigm converged after ${result.attempts} attempts!`);
      this.currentParadigm = null;
      await this.transitionTo(STATES.IDLE, 'evolution-success');
    } else {
      this.log(`EVOLVING: paradigm failed to converge (${result.reason}) 鈥?marking as unresolvable`);
      this.currentParadigm = null;
      await this.transitionTo(STATES.IDLE, 'evolution-failed');
    }
  }

  // 鈹€鈹€鈹€ Event Handling 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  emit(event, data) {
    this.log(`EVENT: ${event} (data: ${JSON.stringify(data)})`);
    this.eventQueue.push({ event, data, ts: Date.now() });
    this.processQueue().catch(e => { this.log('[processQueue] error: ' + e.message); });
  }

  async processQueue() {
    while (this.eventQueue.length > 0) {
      const { event, data } = this.eventQueue.shift();
      switch (event) {
        case EVENTS.ENTROPY_SPIKE:
          if (this.state === STATES.IDLE) await this.transitionTo(STATES.REFLECTING, 'entropy-spike');
          break;
        case EVENTS.DREAM_TRIGGER:
          if (this.state === STATES.IDLE) await this.transitionTo(STATES.DREAMING, 'dream-trigger');
          break;
        case EVENTS.MANUAL_WAKE:
          await this.transitionTo(STATES.REFLECTING, 'manual-wake');
          break;
      }
    }
  }

  // 鈹€鈹€鈹€ Heartbeat (Entropy Monitor) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  startHeartbeat() {
    this.log(`Starting entropy heartbeat (every ${CONFIG.HEARTBEAT_INTERVAL / 1000}s)`);
    this.heartbeatTimer = setInterval(() => {
      if (this.state !== STATES.IDLE) return;
      const entropy = computeGlobalEntropy();
      this.lastEntropy = entropy;
      if (entropy >= CONFIG.ENTROPY_THRESHOLD) {
        this.log(`Entropy spike detected: ${entropy.toFixed(4)} >= ${CONFIG.ENTROPY_THRESHOLD}`);
        this.emit(EVENTS.ENTROPY_SPIKE, { entropy });
      }
    }, CONFIG.HEARTBEAT_INTERVAL);
  }

  startDreamScheduler() {
    this.log('Starting dream-micro scheduler (every 2min)');
    this.dreamTimer = setInterval(() => {
      if (this.state === STATES.IDLE) {
        this.emit(EVENTS.DREAM_TRIGGER);
      }
    }, CONFIG.DREAM_INTERVAL);
  }

  // 鈹€鈹€鈹€ Lifecycle 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  start() {
    if (this.isRunning) { this.log('Already running'); return; }
    this.isRunning = true;

    // Write PID file
    try { fs.writeFileSync(CONFIG.PID_FILE, String(process.pid), 'utf8'); } catch(e) { console.error('[SSC-Daemon] PID write failed:', e.message); }
    // Clean old log
    try { fs.writeFileSync(CONFIG.LOG_FILE, `=== SSC Daemon started at ${this.stats.startedAt} ===\n`, 'utf8'); } catch(e) { console.error('[SSC-Daemon] LOG write failed:', e.message); }

    this.startHeartbeat();
    this.startDreamScheduler();
    this.log('Star Soul Core Daemon started');
    console.log(`[SSC-Daemon] Running at PID ${process.pid}`);
    console.log(`[SSC-Daemon] States: ${Object.values(STATES).join(' | ')}`);
    console.log(`[SSC-Daemon] Entropy threshold: ${CONFIG.ENTROPY_THRESHOLD}`);
    console.log(`[SSC-Daemon] Heartbeat: ${CONFIG.HEARTBEAT_INTERVAL / 1000}s | Dream: ${CONFIG.DREAM_INTERVAL / 1000}s`);
  }

  stop() {
    this.log('Stopping daemon...');
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.dreamTimer) clearInterval(this.dreamTimer);
    this.isRunning = false;
    try { fs.unlinkSync(CONFIG.PID_FILE); } catch(e) { console.error('[SSC-Daemon] PID remove failed:', e.message); }
    this.log('Daemon stopped');
  }

  getStatus() {
    return {
      state: this.state,
      isRunning: this.isRunning,
      lastEntropy: this.lastEntropy,
      stats: this.stats,
      uptime: this.isRunning ? (Date.now() - new Date(this.stats.startedAt).getTime()) / 1000 : 0,
    };
  }
}

// 鈹€鈹€鈹€ Singleton 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

let daemon = null;

function getDaemon() {
  if (!daemon) daemon = new StarSoulCore();
  return daemon;
}

// 鈹€鈹€鈹€ CLI 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

const cmd = process.argv[2];

if (cmd === 'status') {
  const d = getDaemon();
  const s = d.getStatus();
  console.log(JSON.stringify(s, null, 2));

} else if (cmd === 'stop') {
  const d = getDaemon();
  d.stop();
  process.exit(0);

} else if (cmd === 'wake') {
  const d = getDaemon();
  d.emit(EVENTS.MANUAL_WAKE);

} else if (cmd === 'daemon') {
  const d = getDaemon();
  d.start();
  // Keep running
  process.on('SIGINT', () => { d.stop(); process.exit(0); });
  process.on('SIGTERM', () => { d.stop(); process.exit(0); });

} else {
  // Default: run as daemon
  const d = getDaemon();
  d.start();
  process.on('SIGINT', () => { d.stop(); process.exit(0); });
  process.on('SIGTERM', () => { d.stop(); process.exit(0); });
}