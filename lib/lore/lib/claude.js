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

async function askClaudeJSON(prompt, opts = {}) {
  const client = getClient();
  const model = opts.model || "claude-sonnet-4-5-20250514";
  const maxTokens = opts.maxTokens || 500;

  const messages = [{ role: "user", content: prompt }];
  const params = { model, max_tokens: maxTokens, messages };
  if (opts.system) params.system = opts.system;

  const response = await client.messages.create(params);
  const text = response.content[0]?.text || "";

  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) throw new Error("Claude did not return valid JSON: " + text.slice(0, 200));

  return JSON.parse(jsonMatch[1].trim());
}

async function askClaude(prompt, opts = {}) {
  const client = getClient();
  const model = opts.model || "claude-sonnet-4-5-20250514";
  const maxTokens = opts.maxTokens || 1000;

  const messages = [{ role: "user", content: prompt }];
  const params = { model, max_tokens: maxTokens, messages };
  if (opts.system) params.system = opts.system;

  const response = await client.messages.create(params);
  return response.content[0]?.text || "";
}

module.exports = { askClaudeJSON, askClaude, getClient };
