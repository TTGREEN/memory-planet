// Memory Recall Inject Plugin
// Injects relevant atoms.db memories into prompt via before_prompt_build hook

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// --- Path setup ---
const thisFile = fileURLToPath(import.meta.url);
const pluginDir = dirname(thisFile);                         // memory/plugins/memory-recall-inject
const pluginsDir = dirname(pluginDir);                       // memory/plugins
const workspaceRoot = dirname(dirname(pluginsDir));         // <workspace>
const ATOMS_DB_PATH = join(workspaceRoot, "memory", "scripts", "atoms-db.js");

// --- Config defaults ---
const DEFAULT_TOP = 3;
const DEFAULT_MIN_SCORE = 0.5;
const DEFAULT_MAX_CHARS = 500;

// --- DB lazy load ---
let dbMod = null;
async function getDb() {
  if (!dbMod) {
    try {
      dbMod = await import(ATOMS_DB_PATH);
    } catch (err) {
      console.warn("[memory-recall-inject] failed to load atoms-db.js:", err.message);
      dbMod = {};
    }
  }
  return dbMod;
}

// --- Query extraction ---
function extractQuery(messages) {
  const userMsgs = (messages || [])
    .filter((m) => m.role === "user" && typeof m.content === "string" && m.content.trim())
    .slice(-2);

  if (userMsgs.length === 0) return null;

  return userMsgs.map((m) => m.content.replace(/\n+/g, " ").trim()).join(" ");
}

// --- Plugin entry ---
export default definePluginEntry({
  id: "memory-recall-inject",
  name: "Memory Recall Inject",

  register(api) {
    api.on(
      "before_prompt_build",
      async (event) => {
        // Read config once
        const cfg = (event.context && event.context.pluginConfig) || {};
        const top = cfg.topAtoms ?? DEFAULT_TOP;
        const minScore = cfg.minScore ?? DEFAULT_MIN_SCORE;
        const maxChars = cfg.maxChars ?? DEFAULT_MAX_CHARS;

        // Extract query from recent user messages
        const query = extractQuery(event.messages);
        if (!query) return;

        // Fetch recall results
        let results = [];
        try {
          const { recall } = await getDb();
          if (typeof recall !== "function") throw new Error("recall not found in atoms-db.js");
          results = await recall(query, top * 2);
        } catch (err) {
          console.warn("[memory-recall-inject] recall error:", err.message);
          return;
        }

        if (!Array.isArray(results) || results.length === 0) return;

        // Filter and cap
        const filtered = results
          .filter((a) => a.importance >= minScore)
          .slice(0, top);

        if (filtered.length === 0) return;

        // Format as memory fragments
        const text = filtered
          .map((a) => `## 相关记忆\n${String(a.content).substring(0, 120)}`)
          .join("\n")
          .substring(0, maxChars);

        return { prependContext: text };
      },
      { priority: 50 },
    );
  },
});