"use strict";
const { fitDocumentExcerpt } = require("./workspace/text-range.cjs");

// Keep small receipts exact. Never pass a silently cut, invalid JSON response.
function serializeToolResult(value, actionKind) {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string") throw Error("COMPUTER_RESULT_INVALID");
  if (Buffer.byteLength(serialized, "utf8") <= 16000) return serialized;
  const metadata = {
    format: "koswork.tool-result-excerpt.v1",
    action_kind: actionKind,
    driver_returned: true,
    excerpt_only: true,
    representation: "serialized_tool_result_prefix",
    original_characters: serialized.length,
    instruction:
      "The driver returned this result; the action may already have had external effects. This is a prefix, possibly incomplete JSON, not a complete receipt. Do not replay an action to recover omitted output. Inspect current state with read-only tools or ask the owner; never invent missing values or hashes."
  };
  const excerpt = fitDocumentExcerpt(serialized, 0, metadata, 10000);
  // No continuation cursor: this transient result cannot be reread by replaying a tool.
  return JSON.stringify({ ...metadata, content: excerpt.content });
}
module.exports = { serializeToolResult };
