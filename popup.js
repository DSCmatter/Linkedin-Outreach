'use strict';

// One scrape produces the profile and its hooks; picking a hook rewrites the note from it.
const session = {
  profile:      null,
  hooks:        [],
  selectedHook: null,
  busy:         false
};

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  wireSettingsEvents();
  wireCurrentEvents();
  wireRecentEvents();
  await checkCurrentPage();
  await loadSettings();
  await renderRecentContacts();
  await renderModeBadge();
});

// The template pastes the ask word for word, so Free Mode asks for the finished sentence.
// A model can turn a rough instruction into a sentence, so AI mode asks for the goal.
const CUSTOM_ASK_COPY = {
  free: {
    label: "Your ask, written as you'd say it to them",
    placeholder: 'e.g. Is the SDE intern role on your team still open?',
    hint: 'Free Mode pastes this as written. Add an AI key in Settings to have it phrased for you.'
  },
  ai: {
    label: 'What do you want from them?',
    placeholder: 'e.g. ask about the SDE intern opening on their team',
    hint: ''
  }
};

async function renderModeBadge() {
  const s   = await loadStoredSettings();
  const key = (s.userApiKey || '').trim();
  const el  = document.getElementById('key-status');
  el.textContent = key ? '● AI Mode' : '● Free Mode';
  el.className   = 'key-status active';
  document.getElementById('regenerate-btn').classList.toggle('hidden', !key);
  document.getElementById('refine-form').classList.toggle('hidden', !key);

  const copy = CUSTOM_ASK_COPY[key ? 'ai' : 'free'];
  document.getElementById('custom-ask-label').textContent = copy.label;
  document.getElementById('custom-ask').placeholder       = copy.placeholder;
  document.getElementById('custom-ask-hint').textContent  = copy.hint;
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector(`.tab-btn[data-tab="${name}"]`).classList.add('active');
  document.getElementById(`tab-${name}`).classList.add('active');
  if (name === 'recent') renderRecentContacts();
}

// ─── Page check ───────────────────────────────────────────────────────────────
async function checkCurrentPage() {
  const [tab]     = await chrome.tabs.query({ active: true, currentWindow: true });
  const onProfile = Boolean(tab && tab.url && /linkedin\.com\/in\/[^/?#]+/.test(tab.url));
  document.getElementById('scrape-btn').disabled = !onProfile;
  document.getElementById('page-warning').classList.toggle('hidden', onProfile);
  return onProfile;
}

// ─── Wire events ──────────────────────────────────────────────────────────────
function wireCurrentEvents() {
  document.getElementById('scrape-btn').addEventListener('click', handleScrapeAndGenerate);
  document.getElementById('regenerate-btn').addEventListener('click', () => writeMessage('Regenerated.'));
  document.getElementById('refine-form').addEventListener('submit', handleRefine);
  document.getElementById('message-type').addEventListener('change', e => {
    document.getElementById('custom-ask-group').classList.toggle('hidden', e.target.value !== 'Custom');
    if (e.target.value === 'Custom') document.getElementById('custom-ask').focus();
  });
  document.getElementById('copy-btn').addEventListener('click', handleCopy);
  document.getElementById('generated-message').addEventListener('input', updateCharCount);
}

function wireSettingsEvents() {
  document.getElementById('save-settings-btn').addEventListener('click', handleSaveSettings);
  document.getElementById('validate-btn').addEventListener('click', handleValidateKey);
  document.getElementById('api-key').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleValidateKey();
  });
  document.getElementById('api-key').addEventListener('input', renderProviderHint);
  document.getElementById('ai-provider').addEventListener('change', renderProviderHint);

  const dropArea = document.getElementById('file-upload-area');
  dropArea.addEventListener('click', () => document.getElementById('resume-upload').click());
  dropArea.addEventListener('dragover', (e) => { e.preventDefault(); dropArea.classList.add('drag-over'); });
  dropArea.addEventListener('dragleave', () => dropArea.classList.remove('drag-over'));
  dropArea.addEventListener('drop', (e) => {
    e.preventDefault();
    dropArea.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) processResumeFile(file);
  });
  document.getElementById('resume-upload').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) processResumeFile(file);
  });
}

function wireRecentEvents() {
  document.getElementById('clear-recent-btn').addEventListener('click', async () => {
    await Cache.clearContacts();
    renderRecentContacts();
  });
}

// ─── Generate ─────────────────────────────────────────────────────────────────
async function handleScrapeAndGenerate() {
  if (session.busy) return;
  session.busy = true;
  hideMessage();
  clearCurrentStatus();
  setButtonLoading(true, 'Reading profile…');

  try {
    const raw = await sendToBackground({ action: 'scrapeProfile' });
    const { profile, hooks } = await sendToBackground({ action: 'analyzeProfile', data: { profile: raw } });
    session.profile = profile;
    session.hooks = hooks;
    session.selectedHook = hooks[0];
    renderProfileCard(profile);
    renderHooks();
    setButtonLoading(true, 'Writing note…');
    await writeMessage('Message ready. Pick a different opener above to rewrite it.');
  } catch (err) {
    showCurrentStatus(err.message, 'error');
  } finally {
    session.busy = false;
    setButtonLoading(false, 'Generate');
  }
}

function writeMessage(doneText) {
  return deliver({
    action: 'generateMessage',
    data: {
      profile:     session.profile,
      hook:        session.selectedHook,
      messageType: document.getElementById('message-type').value,
      tone:        document.getElementById('tone').value,
      customAsk:   document.getElementById('custom-ask').value.trim()
    }
  }, doneText);
}

async function handleRefine(e) {
  e.preventDefault();
  const input = document.getElementById('refine-input');
  const btn   = document.getElementById('refine-btn');
  const instruction = input.value.trim();
  if (!instruction || session.busy) return;

  session.busy = true;
  btn.disabled = true;
  btn.textContent = 'Rewriting…';
  const ok = await deliver({
    action: 'refineMessage',
    data: { profile: session.profile, message: document.getElementById('generated-message').value, instruction }
  }, `Rewritten: ${instruction}`);
  if (ok) input.value = '';
  btn.disabled = false;
  btn.textContent = 'Rewrite';
  session.busy = false;
}

// Sends one generate or rewrite request, shows the note, and records it in Recent.
async function deliver(request, doneText) {
  if (!session.profile) return false;
  try {
    const message = await sendToBackground(request);
    renderMessage(message);
    showCurrentStatus(doneText, 'success');
    await Cache.addContact({
      profileUrl: session.profile.profileUrl,
      name:       session.profile.name || 'Unknown',
      headline:   session.profile.headline,
      company:    session.profile.currentCompany,
      message,
      timestamp:  Date.now()
    });
    return true;
  } catch (err) {
    showCurrentStatus(err.message, 'error');
    return false;
  }
}

function renderHooks() {
  const panel = document.getElementById('hooks-panel');
  const list  = document.getElementById('hooks-list');
  list.replaceChildren(...session.hooks.map(hook => {
    const chip = document.createElement('button');
    chip.className   = 'hook-chip' + (hook.id === session.selectedHook?.id ? ' selected' : '');
    chip.textContent = hook.label;
    chip.title       = hook.line;
    chip.addEventListener('click', async () => {
      if (session.busy || hook.id === session.selectedHook?.id) return;
      session.selectedHook = hook;
      renderHooks();
      await writeMessage(`Rewritten to open with: ${hook.label}`);
    });
    return chip;
  }));
  panel.classList.toggle('hidden', session.hooks.length === 0);
}

// ─── Settings ─────────────────────────────────────────────────────────────────
async function loadSettings() {
  const s = await loadStoredSettings();
  if (s.userApiKey) document.getElementById('api-key').value = s.userApiKey;
  document.getElementById('ai-provider').value = s.aiProvider || 'auto';
  document.getElementById('ai-model').value    = s.aiModel || '';
  document.getElementById('ai-base-url').value = s.aiBaseUrl || '';
  renderProviderHint();
  if (s.userName)   document.getElementById('user-name').value = s.userName;
  if (s.userBio)    document.getElementById('user-bio').value = s.userBio;
  document.getElementById('offer-resume').checked = Boolean(s.offerResume);
  if (s.resumeFileName) {
    document.getElementById('file-label').textContent = s.resumeFileName;
    document.getElementById('file-upload-area').classList.add('has-file');
    showResumeStatus(`${s.resumeFileName} read. ${(s.resumeSkills || []).length} skills found.`, 'success');
  }
}

function readConnectionForm() {
  return {
    userApiKey: document.getElementById('api-key').value.trim(),
    aiProvider: document.getElementById('ai-provider').value,
    aiModel:    document.getElementById('ai-model').value.trim(),
    aiBaseUrl:  document.getElementById('ai-base-url').value.trim()
  };
}

function renderProviderHint() {
  const { userApiKey, aiProvider } = readConnectionForm();
  const id = aiProvider !== 'auto' ? aiProvider : detectProvider(userApiKey);
  const provider = PROVIDERS[id];
  document.getElementById('ai-model').placeholder = provider?.defaultModel || 'model name';
  document.getElementById('base-url-group').classList.toggle('hidden', id !== 'custom');

  const hint = document.getElementById('provider-hint');
  if (!userApiKey)                hint.textContent = '';
  else if (aiProvider !== 'auto') hint.textContent = '';
  else if (provider)              hint.textContent = `Detected: ${provider.label}. Leave Model empty to use ${provider.defaultModel}.`;
  else                            hint.textContent = "Can't tell which provider this key is for. Pick one above.";
}

// A custom base URL is a host the manifest can't list ahead of time, so Chrome must ask
// the user for it. This has to run first in a click handler, while the click still counts.
async function grantCustomHost(form) {
  if (form.aiProvider !== 'custom' || !/^https?:\/\//.test(form.aiBaseUrl)) return;
  const origin = `${new URL(form.aiBaseUrl).origin}/*`;
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) throw new Error(`Chrome needs permission to reach ${new URL(form.aiBaseUrl).host}.`);
}

async function handleSaveSettings() {
  const form = readConnectionForm();
  try {
    await grantCustomHost(form);
  } catch (err) {
    showSettingsStatus(err.message, 'error');
    return;
  }
  await chrome.storage.local.set({
    ...form,
    userName:    document.getElementById('user-name').value.trim(),
    userBio:     document.getElementById('user-bio').value.trim(),
    offerResume: document.getElementById('offer-resume').checked
  });
  showSettingsStatus('Settings saved!', 'success');
  await renderModeBadge();
}

async function handleValidateKey() {
  const form = readConnectionForm();
  if (!form.userApiKey) return;

  const btn = document.getElementById('validate-btn');
  const el = document.getElementById('key-validation-status');
  el.classList.remove('hidden');
  try {
    await grantCustomHost(form);
    btn.textContent = '…';
    btn.disabled = true;
    const { provider, model } = await sendToBackground({ action: 'testApiKey', data: form });
    await chrome.storage.local.set(form);
    el.textContent = `✓ Works with ${provider} (${model}). AI Mode on.`;
    el.className   = 'key-validation-status valid';
    await renderModeBadge();
  } catch (err) {
    el.textContent = `✗ ${err.message}`;
    el.className   = 'key-validation-status invalid';
  } finally {
    btn.textContent = 'Test';
    btn.disabled = false;
  }
}

// ─── Resume ───────────────────────────────────────────────────────────────────
async function processResumeFile(file) {
  if (file.type !== 'application/pdf') { showResumeStatus('Please upload a PDF file.', 'error'); return; }
  if (file.size > 4 * 1024 * 1024)     { showResumeStatus('File too large. Max 4MB.', 'error'); return; }

  showResumeStatus(`Reading ${file.name}…`, 'pending');
  try {
    const base64 = await readAsBase64(file);
    const { pitch, skills, companies } = await sendToBackground({ action: 'parseResume', data: { base64 } });
    const bioEl = document.getElementById('user-bio');
    const update = { resumeFileName: file.name, resumeSkills: skills, resumeCompanies: companies };
    if (!bioEl.value.trim() && pitch) { bioEl.value = pitch; update.userBio = pitch; }
    await chrome.storage.local.set(update);
    await chrome.storage.local.remove('resumeBase64');
    document.getElementById('file-label').textContent = file.name;
    document.getElementById('file-upload-area').classList.add('has-file');
    showResumeStatus(`${file.name} read. ${skills.length} skills found.`, 'success');
  } catch (err) {
    showResumeStatus(err.message, 'error');
  }
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Error reading file.'));
    reader.readAsDataURL(file);
  });
}

function showResumeStatus(msg, type) {
  const el = document.getElementById('resume-status');
  el.textContent = msg;
  el.className   = `resume-status ${type}`;
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function renderProfileCard(data) {
  document.getElementById('profile-section').classList.remove('hidden');
  const name = data.name || 'Unknown';
  document.getElementById('profile-avatar').textContent   = name.charAt(0).toUpperCase();
  document.getElementById('profile-name').textContent     = name;
  document.getElementById('profile-headline').textContent = data.headline || '';
  document.getElementById('profile-company').textContent  = data.currentCompany || '';
}

function renderMessage(text) {
  document.getElementById('generated-message').value = text;
  document.getElementById('message-section').classList.remove('hidden');
  updateCharCount();
}

function hideMessage() { document.getElementById('message-section').classList.add('hidden'); }

function updateCharCount() {
  const n  = document.getElementById('generated-message').value.length;
  const el = document.getElementById('char-count');
  el.textContent = n > NOTE_LIMIT ? `${n} / ${NOTE_LIMIT}: too long for a connection note` : `${n} / ${NOTE_LIMIT}`;
  el.classList.toggle('over', n > NOTE_LIMIT);
}

async function handleCopy() {
  const text = document.getElementById('generated-message').value;
  if (!text) return;
  try { await navigator.clipboard.writeText(text); } catch (_) {
    const ta = document.getElementById('generated-message');
    ta.select(); document.execCommand('copy');
  }
  const btn = document.getElementById('copy-btn');
  btn.textContent = '✓ Copied!';
  btn.classList.add('btn-secondary'); btn.classList.remove('btn-primary');
  setTimeout(() => {
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2"/></svg> Copy`;
    btn.classList.remove('btn-secondary'); btn.classList.add('btn-primary');
  }, 2200);
}

function showCurrentStatus(msg, type = '') {
  const el = document.getElementById('status-message');
  el.textContent = msg;
  el.className = `status-bar${type ? ' status-' + type : ''}`;
}

function clearCurrentStatus() {
  const el = document.getElementById('status-message');
  el.classList.add('hidden');
  el.textContent = '';
}

function showSettingsStatus(msg, type = '') {
  const el = document.getElementById('settings-status');
  el.textContent = msg;
  el.className = `status-bar${type ? ' status-' + type : ''}`;
  setTimeout(() => el.classList.add('hidden'), 2500);
}

function setButtonLoading(loading, labelText) {
  document.getElementById('scrape-btn').disabled = loading;
  document.getElementById('btn-label').textContent = labelText;
  document.getElementById('btn-spinner').classList.toggle('hidden', !loading);
}

// ─── Recent contacts ──────────────────────────────────────────────────────────
async function renderRecentContacts() {
  const contacts  = await Cache.getContacts();
  const listEl    = document.getElementById('recent-list');
  const emptyEl   = document.getElementById('no-recent');
  const actionsEl = document.getElementById('recent-actions');
  listEl.innerHTML = '';
  if (contacts.length === 0) {
    emptyEl.classList.remove('hidden'); actionsEl.classList.add('hidden'); return;
  }
  emptyEl.classList.add('hidden'); actionsEl.classList.remove('hidden');
  contacts.forEach((c, i) => listEl.appendChild(buildContactCard(c, i)));
}

function buildContactCard(contact, idx) {
  const card = document.createElement('div');
  card.className = 'contact-card';
  const date    = new Date(contact.timestamp).toLocaleDateString('en-US', { month:'short', day:'numeric' });
  const preview = (contact.message || '').substring(0, 110) + ((contact.message || '').length > 110 ? '…' : '');
  card.innerHTML = `
    <div class="contact-header">
      <div class="contact-info">
        <div class="contact-name">${esc(contact.name||'Unknown')}</div>
        <div class="contact-meta">${esc(contact.headline||contact.company||'')}</div>
      </div>
      <div class="contact-date">${esc(date)}</div>
    </div>
    <div class="contact-message-preview" id="prev-${idx}">${esc(preview)}</div>
    <div class="contact-message-full hidden" id="full-${idx}">${esc(contact.message||'')}</div>
    <div class="contact-actions">
      <button class="btn-link" id="expand-${idx}">Show full message</button>
      <button class="btn btn-sm btn-primary" id="copy-c-${idx}">Copy</button>
    </div>`;

  card.querySelector(`#expand-${idx}`).addEventListener('click', () => {
    const isHidden = card.querySelector(`#full-${idx}`).classList.contains('hidden');
    card.querySelector(`#prev-${idx}`).classList.toggle('hidden', isHidden);
    card.querySelector(`#full-${idx}`).classList.toggle('hidden', !isHidden);
    card.querySelector(`#expand-${idx}`).textContent = isHidden ? 'Show less' : 'Show full message';
  });

  card.querySelector(`#copy-c-${idx}`).addEventListener('click', async () => {
    await navigator.clipboard.writeText(contact.message || '').catch(() => {});
    const btn = card.querySelector(`#copy-c-${idx}`);
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2200);
  });

  return card;
}

// ─── Chrome messaging ─────────────────────────────────────────────────────────
async function sendToBackground(msg) {
  const response = await chrome.runtime.sendMessage(msg);
  if (!response) throw new Error('No response from background.');
  if (!response.success) throw new Error(response.error || 'Background returned an error.');
  return response.data;
}

function loadStoredSettings() {
  return chrome.storage.local.get(['userApiKey', 'aiProvider', 'aiModel', 'aiBaseUrl', 'userName', 'userBio', 'offerResume', 'resumeFileName', 'resumeSkills']);
}

function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
