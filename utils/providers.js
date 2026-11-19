'use strict';

// Each provider says how to recognise its key, which model to use by default, and how to
// turn our provider-neutral parts ({ type: 'text' } or { type: 'pdf' }) into its request.
const PROVIDERS = {
  anthropic: {
    label: 'Anthropic (Claude)',
    keyPattern: /^sk-ant-/,
    defaultModel: 'claude-haiku-5-5',
    readsPdf: true,
    request: ({ apiKey, model }, parts, maxTokens) => ({
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: {
        model,
        max_tokens: maxTokens,
        messages: [{
          role: 'user',
          content: parts.map(p => p.type === 'pdf'
            ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.base64 } }
            : { type: 'text', text: p.text })
        }]
      }
    }),
    text: data => (data.content || []).map(c => c.text || '').join('')
  },

  gemini: {
    label: 'Google Gemini',
    keyPattern: /^AIza/,
    defaultModel: 'gemini-3.6-flash',
    readsPdf: true,
    request: ({ apiKey, model }, parts) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      headers: { 'x-goog-api-key': apiKey },
      body: {
        contents: [{
          role: 'user',
          parts: parts.map(p => p.type === 'pdf'
            ? { inline_data: { mime_type: 'application/pdf', data: p.base64 } }
            : { text: p.text })
        }]
      }
    }),
    text: data => (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('')
  },

  openrouter: openAICompatible({ label: 'OpenRouter', keyPattern: /^sk-or-/, baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openrouter/auto', readsPdf: true }),
  groq:       openAICompatible({ label: 'Groq', keyPattern: /^gsk_/, baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile', readsPdf: false }),
  openai:     openAICompatible({ label: 'OpenAI', keyPattern: /^sk-/, baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4.1-mini', readsPdf: true }),
  custom:     openAICompatible({ label: 'Custom (OpenAI-compatible)', keyPattern: null, baseUrl: null, defaultModel: null, readsPdf: false })
};

// Most providers (OpenAI, OpenRouter, Groq, Together, Mistral, DeepSeek, Ollama...) speak the
// OpenAI chat-completions format, so one adapter covers all of them given a base URL.
function openAICompatible({ label, keyPattern, baseUrl, defaultModel, readsPdf }) {
  return {
    label, keyPattern, defaultModel, readsPdf, baseUrl,
    request: ({ apiKey, model, baseUrl: customBase }, parts, maxTokens) => ({
      url: `${(baseUrl || customBase || '').replace(/\/+$/, '')}/chat/completions`,
      headers: { Authorization: `Bearer ${apiKey}` },
      body: {
        model,
        max_tokens: maxTokens,
        messages: [{
          role: 'user',
          content: parts.every(p => p.type === 'text')
            ? parts.map(p => p.text).join('\n\n')
            : parts.map(p => p.type === 'pdf'
              ? { type: 'file', file: { filename: 'resume.pdf', file_data: `data:application/pdf;base64,${p.base64}` } }
              : { type: 'text', text: p.text })
        }]
      }
    }),
    text: data => {
      const c = data.choices?.[0]?.message?.content;
      return Array.isArray(c) ? c.map(x => x.text || '').join('') : (c || '');
    }
  };
}

// Key order matters: 'sk-ant-' and 'sk-or-' must be checked before the generic OpenAI 'sk-'.
const DETECT_ORDER = ['anthropic', 'openrouter', 'groq', 'gemini', 'openai'];

function detectProvider(apiKey) {
  const key = String(apiKey || '').trim();
  return DETECT_ORDER.find(id => PROVIDERS[id].keyPattern.test(key)) || null;
}

// AI Mode needs a key, and the user can switch it off without deleting the key.
function aiActive({ userApiKey, aiEnabled }) {
  return Boolean(String(userApiKey || '').trim()) && aiEnabled !== false;
}

// Turns stored settings into one complete connection, or explains what is missing.
function resolveConnection({ userApiKey, aiEnabled, aiProvider, aiModel, aiBaseUrl }) {
  if (!aiActive({ userApiKey, aiEnabled })) return null;
  const apiKey = String(userApiKey).trim();
  const id = aiProvider && aiProvider !== 'auto' ? aiProvider : detectProvider(apiKey);
  if (!id || !PROVIDERS[id]) {
    throw new Error("Couldn't tell which AI provider this key is for. Pick it under Provider, or choose Custom and add its base URL.");
  }
  const provider = PROVIDERS[id];
  const model = String(aiModel || '').trim() || provider.defaultModel;
  const baseUrl = String(aiBaseUrl || '').trim();
  if (id === 'custom' && !/^https?:\/\//.test(baseUrl)) throw new Error('Custom provider needs a base URL, like https://api.together.xyz/v1');
  if (!model) throw new Error(`${provider.label} needs a model name in Settings.`);
  return { id, provider, apiKey, model, baseUrl };
}

async function callAI(conn, parts, maxTokens) {
  const { url, headers, body } = conn.provider.request(conn, parts, maxTokens);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (Array.isArray(data) ? data[0] : data)?.error?.message || `HTTP ${res.status}`;
    throw new Error(`${conn.provider.label}: ${detail}`);
  }
  const text = conn.provider.text(data).trim();
  if (!text) throw new Error(`${conn.provider.label} (${conn.model}) returned no text.`);
  return text;
}
