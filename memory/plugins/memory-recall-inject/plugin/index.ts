// plugin/index.ts — Memory Recall Inject Plugin
// Hooks into before_prompt_build to inject relevant atoms.db memories as prependContext

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { recallAtoms } from "./recall.js";

export default definePluginEntry({
  id: "memory-recall-inject",
  name: "Memory Recall Inject",
  register(api) {
    api.on(
      "before_prompt_build",
      async (event) => {
        // Extract query from the last 1-2 user messages
        const query = extractQuery(event.messages);
        if (!query) return;

        // Recall top 3 relevant atoms, minimum score 0.5
        const results = await recallAtoms(query, { top: 3, minScore: 0.5 });
        if (results.length === 0) return;

        // Format as concise memory fragments, cap at 500 chars total
        const MAX_CHARS = 500;
        const lines = results.map((a) => `[记忆] ${a.content}`);
        let text = lines.join("\n");
        if (text.length > MAX_CHARS) {
          text = text.substring(0, MAX_CHARS - 3) + "...";
        }

        return { prependContext: text };
      },
      { priority: 50 },
    );
  },
});

// --- Query extraction ---

interface Message {
  role?: string;
  content?: string;
}

/**
 * Pull the last 1-2 user messages and join their text content as the recall query.
 * Skips messages without content.
 */
function extractQuery(messages: Message[]): string | null {
  const userMsgs = messages
    .filter((m) => m.role === "user" && m.content)
    .slice(-2);

  if (userMsgs.length === 0) return null;

  return userMsgs
    .map((m) => m.content!.replace(/\n+/g, " ").trim())
    .join(" ");
}