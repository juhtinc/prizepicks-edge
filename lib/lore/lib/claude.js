/**
 * api/lore/lib/claude.js
 * Claude API wrapper for Sports Lore AI tasks.
 */

const Anthropic = require("@anthropic-ai/sdk");

let _client;
function getClient() {
  if (!_client) _client = new Anthropic();
  return _client;
}

/**
 * Strip mojibake and invalid Unicode from text.
 * Claude responses sometimes contain double-encoded UTF-8 sequences
 * that appear as garbled characters (e.g., Ã¢â‚¬â„¢ instead of —).
 */
function sanitizeText(text) {
  if (!text || typeof text !== "string") return text;
  return text
    .replace(/[\uD800-\uDFFF]/g, "")                              // unpaired surrogates
    .replace(/Ã[^\x00-\x7F][^\x00-\x7F\s]*/g, " — ")             // mojibake sequences starting with Ã
    .replace(/â‚¬[^\x00-\x7F]*/g, "")                              // euro-sign mojibake
    .replace(/Â[^\x00-\x7F]*/g, "")                                // Â-prefix mojibake
    .replace(/[^\x00-\x7F\u00C0-\u024F\u2000-\u206F\u2013-\u2014\u2018-\u201D]/g, "") // strip remaining non-ASCII except common chars
    .replace(/\s{2,}/g, " ")                                       // collapse extra spaces
    .trim();
}

/**
 * Recursively sanitize all string values in a JSON object.
 */
function sanitizeJSON(obj) {
  if (typeof obj === "string") return sanitizeText(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeJSON);
  if (obj && typeof obj === "object") {
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = sanitizeJSON(v);
    }
    return result;
  }
  return obj;
}

async function askClaudeJSON(prompt, opts = {}) {
  const client = getClient();
  const model = opts.model || "claude-sonnet-4-6";
  const maxTokens = opts.maxTokens || 500;

  const messages = [{ role: "user", content: prompt }];
  const params = { model, max_tokens: maxTokens, messages };
  if (opts.system) params.system = opts.system;

  const response = await client.messages.create(params);
  const text = response.content[0]?.text || "";

  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) throw new Error("Claude did not return valid JSON: " + text.slice(0, 200));

  const parsed = JSON.parse(jsonMatch[1].trim());
  return sanitizeJSON(parsed);
}

async function askClaude(prompt, opts = {}) {
  const client = getClient();
  const model = opts.model || "claude-sonnet-4-6";
  const maxTokens = opts.maxTokens || 1000;

  const messages = [{ role: "user", content: prompt }];
  const params = { model, max_tokens: maxTokens, messages };
  if (opts.system) params.system = opts.system;

  const response = await client.messages.create(params);
  return sanitizeText(response.content[0]?.text || "");
}

module.exports = { askClaudeJSON, askClaude, getClient };
