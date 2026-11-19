'use strict';

// Messages are written by a local template for free, or by an AI model with the user's own key.
importScripts('utils/message.js', 'utils/providers.js');

const SETTINGS_KEYS = ['userApiKey', 'aiProvider', 'aiModel', 'aiBaseUrl', 'userName', 'userBio', 'offerResume', 'resumeSkills', 'resumeCompanies'];

const HANDLERS = {
  scrapeProfile:   () => scrapeActiveTab(),
  analyzeProfile:  ({ profile }) => analyzeProfile(profile),
  generateMessage: (req) => generateMessage(req),
  refineMessage:   (req) => refineMessage(req),
  testApiKey:      (form) => testConnection(form),
  parseResume:     ({ base64 }) => parseResume(base64)
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = HANDLERS[message.action];
  if (!handler) return false;
  handler(message.data || {})
    .then(data => sendResponse({ success: true, data }))
    .catch(err => sendResponse({ success: false, error: err.message }));
  return true;
});

async function scrapeActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab found.');
  if (!tab.url || !/linkedin\.com\/in\//.test(tab.url)) {
    throw new Error('Please open a LinkedIn profile page first.');
  }

  let result;
  try {
    result = await chrome.tabs.sendMessage(tab.id, { action: 'scrapeProfile' });
  } catch (_) {
    // The tab was open before the extension loaded, so the content script isn't there yet.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['utils/parse.js', 'content_script.js'] });
    result = await chrome.tabs.sendMessage(tab.id, { action: 'scrapeProfile' });
  }

  if (!result?.success) throw new Error(result?.error || 'Scrape failed.');
  return result.data;
}

async function analyzeProfile(raw) {
  const settings = await getSettings();
  const profile  = normalizeProfile(raw);
  return { profile, hooks: buildHooks(profile, settings) };
}

async function generateMessage({ profile, ...request }) {
  const settings = await getSettings();
  const conn     = resolveConnection(settings);
  return conn
    ? callAI(conn, [{ type: 'text', text: notePrompt(profile, request, settings) }], 400)
    : composeMessage(profile, request.hook, { ...settings, ...request });
}

async function refineMessage({ profile, message, instruction }) {
  const settings = await getSettings();
  const conn     = resolveConnection(settings);
  if (!conn) throw new Error('Rewriting with instructions needs an AI API key. Add one in Settings.');
  return callAI(conn, [{ type: 'text', text: refinePrompt(profile, { message, instruction }, settings) }], 400);
}

async function testConnection(form) {
  const conn = resolveConnection(form);
  if (!conn) throw new Error('Enter an API key first.');
  await callAI(conn, [{ type: 'text', text: 'Reply with the single word: OK' }], 16);
  return { provider: conn.provider.label, model: conn.model };
}

function normalizeProfile(raw = {}) {
  const name = (raw.name || '').trim();
  return {
    name,
    firstName:         name.split(/\s+/)[0] || 'there',
    headline:          raw.headline || '',
    currentTitle:      raw.currentTitle || '',
    currentCompany:    raw.currentCompany || '',
    about:             raw.about || '',
    recentPosts:       raw.recentPosts || [],
    pastCompanies:     raw.pastCompanies || [],
    educationEntries:  raw.educationEntries || [],
    skills:            raw.skills || [],
    profileUrl:        raw.profileUrl || ''
  };
}

async function parseResume(base64) {
  const conn = resolveConnection(await getSettings());
  if (!conn) throw new Error('Add an AI API key first. The model reads the resume once.');
  if (!conn.provider.readsPdf) {
    throw new Error(`${conn.provider.label} can't read PDFs here. Write your pitch by hand, or use an Anthropic, OpenAI, Gemini or OpenRouter key.`);
  }
  const text = await callAI(conn, [
    { type: 'pdf', base64 },
    { type: 'text', text:
`Read this resume. Return only JSON, no prose:
{"pitch": "<one first-person sentence under 140 characters on who they are and what they build>",
 "skills": ["<up to 15 concrete skills or technologies>"],
 "companies": ["<every employer and university named>"]}` }
  ], 800);

  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  const strings = xs => (Array.isArray(xs) ? xs : []).filter(x => typeof x === 'string' && x.trim()).map(x => x.trim());
  return {
    pitch:     typeof json.pitch === 'string' ? json.pitch.trim().slice(0, 150) : '',
    skills:    strings(json.skills).slice(0, 15),
    companies: strings(json.companies).slice(0, 15)
  };
}

function getSettings() {
  return chrome.storage.local.get(SETTINGS_KEYS);
}
