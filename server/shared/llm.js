// Thin Ollama wrapper. Picks whichever qwen2.5 / llama3 model is installed so
// the demo does not depend on one exact tag, and reports plainly when no model
// is reachable so every caller can fall back to its deterministic path.

const OLLAMA_API = process.env.OLLAMA_URL || 'http://localhost:11434';
const PREFERRED = (process.env.OLLAMA_MODEL || 'qwen2.5:7b-instruct,qwen2.5:7b,qwen2.5,llama3.1:8b,llama3.1,llama3').split(',');

let cachedModel = null;
let cachedAt = 0;

async function pickModel() {
  if (cachedModel && Date.now() - cachedAt < 60000) return cachedModel;
  try {
    const res = await fetch(`${OLLAMA_API}/api/tags`, { signal: AbortSignal.timeout(2500) });
    const data = await res.json();
    const names = (data.models || []).map(m => m.name);
    for (const want of PREFERRED) {
      const hit = names.find(n => n === want || n.startsWith(want + ':') || n.startsWith(want));
      if (hit) { cachedModel = hit; cachedAt = Date.now(); return hit; }
    }
    cachedModel = null;
  } catch {
    cachedModel = null;
  }
  cachedAt = Date.now();
  return null;
}

async function chat(messages, { tools, json = false, timeout = 90000 } = {}) {
  const model = await pickModel();
  if (!model) throw new Error('Ollama unavailable');
  const body = { model, messages, stream: false, options: { temperature: 0.1 } };
  if (tools) body.tools = tools;
  if (json) body.format = 'json';
  const res = await fetch(`${OLLAMA_API}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`Ollama error ${res.status}`);
  const data = await res.json();
  return { message: data.message, model };
}

module.exports = { pickModel, chat, OLLAMA_API };
