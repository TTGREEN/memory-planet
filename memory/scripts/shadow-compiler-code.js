// ─── Shadow Compiler: Synthesize wiki blocks from high-importance atoms ────

/**
 * Simple rules-based synthesis — no LLM needed.
 * Strategy:
 * 1. Cluster atoms by namespace
 * 2. Within each namespace cluster, find structural duplicates (sim > 0.5)
 * 3. Merge duplicate atoms: pick the more general/formal wording
 * 4. Detect cross-namespace duplicates (same content different namespace)
 * 5. Emit one wiki block per synthesized cluster
 *
 * Generalization rules:
 * - Prefer formal third-person over informal/first-person
 * - Prefer concise over verbose
 * - Prefer absolute statements over hedged ("always" > "sometimes")
 */

function generalizeAtomContent(atoms) {
  if (atoms.length === 1) return atoms[0].content;
  const candidates = atoms.map(a => a.content);
  // Prefer content without first-person pronouns
  const thirdPerson = candidates.filter(c => !/^我[是愿]|我的|我用/.test(c));
  const use = thirdPerson.length > 0 ? thirdPerson : candidates;
  // Pick shortest that is not just keywords
  return use.sort((a, b) => a.length - b.length)[0];
}

/**
 * Cluster atoms by rough topic using keyword extraction.
 * Returns: Map<topicKey, { topic, atoms }>
 */
function clusterAtomsByTopic(atoms) {
  const clusters = new Map();
  const stopwords = /^[的是在了有和与也但就等要能很了]$/;
  for (const atom of atoms) {
    const words = atom.content
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopwords.test(w));
    // Top 3 most "specific" words (longest that aren't common stopwords)
    const topWords = words
      .filter(w => w.length > 2)
      .sort((a, b) => b.length - a.length)
      .slice(0, 3)
      .join(' ');
    const key = topWords || 'general';
    if (!clusters.has(key)) clusters.set(key, { topic: topWords, atoms: [] });
    clusters.get(key).atoms.push(atom);
  }
  return clusters;
}

/**
 * Synthesize: find duplicate/similar atoms within a group, merge into one.
 * Returns: Array of { synthesizedContent, sourceAtoms }
 */
function synthesizeGroup(atoms) {
  if (atoms.length === 0) return [];
  const results = [];
  const used = new Set();

  for (let i = 0; i < atoms.length; i++) {
    if (used.has(atoms[i].id)) continue;
    const group = [atoms[i]];
    used.add(atoms[i].id);

    for (let j = i + 1; j < atoms.length; j++) {
      if (used.has(atoms[j].id)) continue;
      const sim = structuralSim(atoms[i], atoms[j]);
      if (sim > 0.5) {
        group.push(atoms[j]);
        used.add(atoms[j].id);
      }
    }

    // Synthesize: merge similar atoms, generalize language
    const synthesized = generalizeAtomContent(group);
    results.push({ synthesizedContent: synthesized, sourceAtoms: group });
  }

  return results;
}

/**
 * Main shadow compile entry point.
 * Scan high-importance atoms, synthesize wiki blocks, insert into wiki_blocks table.
 *
 * @param {number} minImportance - Minimum importance threshold (default 0.6)
 * @returns {Promise<{ created: number, skipped: number, errors: string[] }>}
 */
async function shadowCompile(minImportance = 0.6) {
  const db = getDb();

  // Fetch high-importance atoms
  const atoms = db.prepare(`
    SELECT id, content, confidence, importance, human_pin, namespace, created_at
    FROM memory_atom
    WHERE importance >= ?
    ORDER BY namespace, importance DESC
  `).all(minImportance);

  if (atoms.length === 0) {
    return { created: 0, skipped: 0, errors: [], message: 'No atoms meeting importance threshold' };
  }

  // Group by namespace
  const nsGroups = {};
  for (const atom of atoms) {
    if (!nsGroups[atom.namespace]) nsGroups[atom.namespace] = [];
    nsGroups[atom.namespace].push(atom);
  }

  const errors = [];
  let created = 0, skipped = 0;

  for (const [namespace, groupAtoms] of Object.entries(nsGroups)) {
    // Cluster within namespace by topic
    const topicClusters = clusterAtomsByTopic(groupAtoms);

    for (const [, { topic, atoms: clusterAtoms }] of topicClusters) {
      // Synthesize each topic cluster
      const synthesized = synthesizeGroup(clusterAtoms);

      for (const { synthesizedContent, sourceAtoms } of synthesized) {
        // Check for near-duplicate wiki block (exact content match, same namespace)
        const existing = db.prepare(`
          SELECT id FROM wiki_blocks WHERE namespace = ? AND content = ?
        `).get(namespace, synthesizedContent);

        if (existing) {
          skipped++;
          continue;
        }

        // Generate embedding for synthesized content
        let embStr = null;
        try {
          const embs = await ollamaEmbed([synthesizedContent]);
          if (embs && embs[0] && embs[0].length > 0) {
            embStr = JSON.stringify(embs[0]);
          }
        } catch(e) {
          errors.push('embedding failed for: ' + synthesizedContent.slice(0, 40) + ' — ' + e.message);
        }

        const sourceIds = JSON.stringify(sourceAtoms.map(a => a.id));
        const importance = Math.max(...sourceAtoms.map(a => a.importance));
        const confidence = sourceAtoms.reduce((s, a) => s + a.confidence, 0) / sourceAtoms.length;
        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        try {
          db.prepare(`
            INSERT INTO wiki_blocks (id, content, source_ids, topic, importance, confidence, embedding, human_pin, namespace, version, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?)
          `).run(id, synthesizedContent, sourceIds, topic || null, importance, confidence, embStr, 0, namespace, now, now);
          created++;
        } catch(e) {
          errors.push('insert failed: ' + e.message);
        }
      }
    }
  }

  return { created, skipped, errors };
}

/**
 * List wiki blocks with optional filters.
 */
function listWikiBlocks(opts = {}) {
  const db = getDb();
  const { namespace, topic, limit = 50 } = opts;
  let sql = 'SELECT * FROM wiki_blocks WHERE status = ?';
  const params = ['active'];
  if (namespace) { sql += ' AND namespace = ?'; params.push(namespace); }
  if (topic) { sql += ' AND topic = ?'; params.push(topic); }
  sql += ' ORDER BY importance DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params);
}

/**
 * Get wiki block count.
 */
function getWikiBlockCount() {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as cnt FROM wiki_blocks WHERE status = ?').get('active');
  return row ? row.cnt : 0;
}