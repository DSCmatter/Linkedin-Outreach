'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const ctx = vm.createContext({});
for (const f of ['utils/parse.js', 'utils/message.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
}
const { parseExperience, parseActivity, headlineFromActivity, extractFromHeadline, nameFromTitle, cleanName, buildHooks, composeMessage, notePrompt, refinePrompt } =
  vm.runInContext('({ parseExperience, parseActivity, headlineFromActivity, extractFromHeadline, nameFromTitle, cleanName, buildHooks, composeMessage, notePrompt, refinePrompt })', ctx);

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok  ' + name); }

test('grouped experience keeps the company, not the tenure (image 3)', () => {
  const e = parseExperience([
    'Salesforce', 'Full-time · 8 yrs 11 mos', 'Bengaluru, Karnataka, India',
    'Senior Manager, Talent Acquisition', 'Apr 2021 - Present · 3 yrs 8 mos', 'Bengaluru, Karnataka, India',
    'Recruiter', 'Jan 2016 - Mar 2021 · 5 yrs 3 mos',
    'Recruitment Lead', 'Infosys · Full-time', 'Jun 2012 - Dec 2015 · 3 yrs 7 mos', 'Mysuru, India'
  ]);
  assert.strictEqual(e[0].title, 'Senior Manager, Talent Acquisition');
  assert.strictEqual(e[0].company, 'Salesforce');
  assert.strictEqual(e[1].company, 'Salesforce');
  assert.strictEqual(e[2].title, 'Recruitment Lead');
  assert.strictEqual(e[2].company, 'Infosys');
  assert.ok(!e.some(x => /yrs|mos/.test(x.company)), 'no tenure used as a company');
});

test('grouped header without employment type', () => {
  const e = parseExperience(['Salesforce', '8 yrs 11 mos', 'Manager', 'Jan 2016 - Present · 8 yrs 11 mos']);
  assert.deepStrictEqual([e[0].title, e[0].company], ['Manager', 'Salesforce']);
});

test('single-role experience still parses', () => {
  const e = parseExperience(['Founding Engineer', 'Psionics · Full-time', 'Mar 2025 - Present · 9 mos', 'Remote']);
  assert.deepStrictEqual([e[0].title, e[0].company], ['Founding Engineer', 'Psionics']);
});

const activity = [
  'Vasant Mogia', 'Doing AI stuff @ Psionics | Ex-Intern at 3x Startups', '2w •',
  'Shipped our first agent eval harness today. It catches prompt regressions before they hit prod.',
  'Like', 'Comment', 'Repost',
  'Vasant Mogia', 'Doing AI stuff @ Psionics | Ex-Intern at 3x Startups', '1mo •',
  'Wrote up what we learned running agents against real codebases for a month.'
];

test('headline is recovered from activity cards when the top card has none', () => {
  assert.strictEqual(headlineFromActivity(activity, 'Vasant Mogia'), 'Doing AI stuff @ Psionics | Ex-Intern at 3x Startups');
});

test('activity never returns the headline as a post (image 4)', () => {
  const posts = parseActivity(activity, { name: 'Vasant Mogia', headline: null });
  assert.ok(!posts.some(p => p.includes('Doing AI stuff')), JSON.stringify(posts));
  assert.strictEqual(posts[0], 'Shipped our first agent eval harness today. It catches prompt regressions before they hit prod.');
});

test('single activity card still skips the headline line', () => {
  const posts = parseActivity(activity.slice(0, 7), { name: 'Vasant Mogia', headline: null });
  assert.ok(!posts.some(p => p.includes('Doing AI stuff')));
});

test('name from the tab title drops the notification count', () => {
  assert.strictEqual(nameFromTitle('(1) Vinayaka DB | LinkedIn'), 'Vinayaka DB');
  assert.strictEqual(nameFromTitle('(99+) Vinayaka DB | LinkedIn'), 'Vinayaka DB');
  assert.strictEqual(nameFromTitle('Vinayaka DB | LinkedIn'), 'Vinayaka DB');
});

test('pronouns are removed from the name, wherever it came from', () => {
  assert.strictEqual(nameFromTitle('(1) Manoj G (He/Him/His) | LinkedIn'), 'Manoj G');
  assert.strictEqual(cleanName('Priya S (she/her)'), 'Priya S');
  assert.strictEqual(cleanName('Alex Kim (they/them)'), 'Alex Kim');
  assert.strictEqual(cleanName('Ana (Annie) Lopez'), 'Ana (Annie) Lopez');
});

test('headline "X @ Company | ..." yields the company, not the tail', () => {
  assert.strictEqual(extractFromHeadline('Doing AI stuff @ Psionics | Ex-Intern at 3x Startups', 'company'), 'Psionics');
});

const bio = "I'm a Senior CS student and software engineer building AI agents, mostly around security and developer tooling. I interned at three startups and love shipping fast.";
const profile = {
  name: 'Vinayaka DB', firstName: 'Vinayaka', currentTitle: 'Senior Manager, Talent Acquisition', currentCompany: 'Salesforce',
  recentPosts: ['We are hiring a Manager/Senior Manager, Technical Consulting (Salesforce experience mandatory) for our Hyderabad office, apply via the link below'],
  skills: ['Vendor Management', 'Talent Acquisition', 'Python'], pastCompanies: ['Infosys']
};

test('no message text is ever cut mid-word with an ellipsis (images 1, 2)', () => {
  for (const hook of buildHooks(profile, {})) {
    for (const messageType of ['Networking', 'Job', 'Referral', 'Collaboration']) {
      for (const tone of ['Formal', 'Neutral', 'Casual']) {
        const m = composeMessage(profile, hook, { messageType, tone, userName: 'Vasant', userBio: bio, offerResume: true });
        assert.ok(!m.includes('…'), m);
        assert.ok(m.length <= 300, `${m.length} chars: ${m}`);
      }
    }
  }
});

test('long post is referenced without quoting a fragment', () => {
  const post = buildHooks(profile, {}).find(h => h.id === 'post');
  assert.strictEqual(post.line, 'I enjoyed your recent post.');
});

test('a quoted post always ends with punctuation before the pitch', () => {
  const p = { ...profile, recentPosts: ['Shipped our new agent eval harness'] };
  const m = composeMessage(p, buildHooks(p, {}).find(h => h.id === 'post'), { messageType: 'Networking', tone: 'Neutral', userBio: "I'm a builder." });
  assert.ok(m.includes('"Shipped our new agent eval harness." I\'m a builder.'), m);
});

test('the chosen hook is what opens the message', () => {
  const hooks = buildHooks(profile, {});
  const skills = hooks.find(h => h.id === 'skills');
  const m = composeMessage(profile, skills, { messageType: 'Networking', tone: 'Neutral', userBio: '' });
  assert.ok(m.includes('Your experience in Vendor Management and Talent Acquisition caught my attention.'), m);
});

test('resume skills shared with the recipient become the first hook', () => {
  const hooks = buildHooks(profile, { resumeSkills: ['python', 'Rust'], resumeCompanies: [] });
  assert.strictEqual(hooks[0].id, 'shared-skills');
  assert.strictEqual(hooks[0].line, 'I noticed we both work with python.');
});

test('resume offer appears only for Job and Referral', () => {
  const hook = buildHooks(profile, {})[0];
  const opts = { tone: 'Neutral', userBio: 'I build AI agents.', offerResume: true };
  assert.ok(composeMessage(profile, hook, { ...opts, messageType: 'Job' }).includes('Happy to share my resume'));
  assert.ok(!composeMessage(profile, hook, { ...opts, messageType: 'Networking' }).includes('resume'));
});

test('when space is short, the pitch is kept and the resume offer is dropped', () => {
  const hook = { id: 'x', label: 'x', line: 'I noticed we both work with Talent Acquisition and Python.' };
  const pitch = "I'm a Senior CS student and software engineer building AI agents, mostly around security and developer tooling.";
  const m = composeMessage(profile, hook, { messageType: 'Job', tone: 'Neutral', userName: 'Vasant', userBio: pitch, offerResume: true });
  assert.ok(m.includes(pitch), m);
  assert.ok(m.length <= 300, String(m.length));
});

test('pitch without a first-person start gets a lead-in, used word for word', () => {
  const m = composeMessage(profile, buildHooks(profile, {})[0], { messageType: 'Networking', tone: 'Neutral', userBio: 'software engineer at Psionics' });
  assert.ok(m.includes('A bit about me: software engineer at Psionics.'), m);
});

test('custom message type uses the sender\'s own ask as a sentence', () => {
  const hook = buildHooks(profile, {})[0];
  const m = composeMessage(profile, hook, { messageType: 'Custom', customAsk: 'would love to hear how you got into recruiting', tone: 'Neutral', userBio: '' });
  assert.ok(m.includes('Would love to hear how you got into recruiting.'), m);
  const empty = composeMessage(profile, hook, { messageType: 'Custom', customAsk: '  ', tone: 'Neutral', userBio: '' });
  assert.ok(empty.includes("I'd love to connect."), empty);
});

test('AI prompt carries the custom goal', () => {
  const p = notePrompt(profile, { hook: buildHooks(profile, {})[0], messageType: 'Custom', tone: 'Casual', customAsk: 'ask about the SDE intern role' }, {});
  assert.ok(p.includes("Purpose: Custom. The sender's goal: ask about the SDE intern role."), p);
  assert.ok(p.includes('Hard limit: 300 characters'));
});

test('rewrite prompt includes the current note, the instruction and the limit', () => {
  const p = refinePrompt(profile, { message: 'Hi Vinayaka, edited by me.', instruction: 'make it shorter' }, { userName: 'Vasant' });
  assert.ok(p.includes('<note>\nHi Vinayaka, edited by me.\n</note>'));
  assert.ok(p.includes("Sender's instruction: make it shorter"));
  assert.ok(p.includes('Hard limit: 300 characters'));
});

const calls = [];
const replies = {
  'api.anthropic.com':                 { content: [{ type: 'text', text: 'OK from claude' }] },
  'api.openai.com':                    { choices: [{ message: { content: 'OK from openai' } }] },
  'generativelanguage.googleapis.com': { candidates: [{ content: { parts: [{ text: 'OK from gemini' }] } }] },
  'openrouter.ai':                     { choices: [{ message: { content: 'OK from openrouter' } }] },
  'api.groq.com':                      { choices: [{ message: { content: 'OK from groq' } }] },
  'api.together.xyz':                  { choices: [{ message: { content: 'OK from custom' } }] }
};
const pctx = vm.createContext({
  URL,
  fetch: async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const host = new URL(url).host;
    if (init.headers['x-api-key'] === 'sk-ant-bad') return { ok: false, status: 401, json: async () => ({ error: { message: 'invalid x-api-key' } }) };
    return { ok: true, status: 200, json: async () => replies[host] };
  }
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'utils/providers.js'), 'utf8'), pctx, { filename: 'utils/providers.js' });
const { detectProvider, resolveConnection, callAI, aiActive } = vm.runInContext('({ detectProvider, resolveConnection, callAI, aiActive })', pctx);

test('provider is detected from the key prefix', () => {
  const cases = { 'sk-ant-api03-x': 'anthropic', 'sk-or-v1-x': 'openrouter', 'gsk_x': 'groq', 'AIzaSyx': 'gemini', 'sk-proj-x': 'openai', 'sk-x': 'openai', 'random': null };
  for (const [key, id] of Object.entries(cases)) assert.strictEqual(detectProvider(key), id, key);
});

test('no key means free mode; unknown key asks the user to pick a provider', () => {
  assert.strictEqual(resolveConnection({ userApiKey: '' }), null);
  assert.throws(() => resolveConnection({ userApiKey: 'xyz' }), /Pick it under Provider/);
});

test('AI Mode switched off keeps the key but uses the free template', () => {
  assert.strictEqual(resolveConnection({ userApiKey: 'sk-ant-1', aiEnabled: false }), null);
  assert.strictEqual(aiActive({ userApiKey: 'sk-ant-1', aiEnabled: false }), false);
  assert.strictEqual(aiActive({ userApiKey: 'sk-ant-1' }), true, 'existing users with no saved switch stay in AI Mode');
  assert.strictEqual(aiActive({ userApiKey: '', aiEnabled: true }), false);
  assert.strictEqual(resolveConnection({ userApiKey: 'sk-ant-1', aiEnabled: true }).id, 'anthropic');
});

test('custom provider requires a base URL', () => {
  assert.throws(() => resolveConnection({ userApiKey: 'abc', aiProvider: 'custom', aiModel: 'm' }), /base URL/);
});

const providerCases = [
  { form: { userApiKey: 'sk-ant-1' },                 host: 'api.anthropic.com', auth: h => h['x-api-key'] === 'sk-ant-1', model: 'claude-haiku-5-5' },
  { form: { userApiKey: 'sk-proj-1' },                host: 'api.openai.com', auth: h => h.Authorization === 'Bearer sk-proj-1', model: 'gpt-4.1-mini' },
  { form: { userApiKey: 'AIza1' },                    host: 'generativelanguage.googleapis.com', auth: h => h['x-goog-api-key'] === 'AIza1', model: 'gemini-3.6-flash' },
  { form: { userApiKey: 'sk-or-1' },                  host: 'openrouter.ai', auth: h => h.Authorization === 'Bearer sk-or-1', model: 'openrouter/auto' },
  { form: { userApiKey: 'gsk_1' },                    host: 'api.groq.com', auth: h => h.Authorization === 'Bearer gsk_1', model: 'llama-3.3-70b-versatile' },
  { form: { userApiKey: 'tg-1', aiProvider: 'custom', aiBaseUrl: 'https://api.together.xyz/v1/', aiModel: 'meta-llama/Llama-3-8b' },
    host: 'api.together.xyz', auth: h => h.Authorization === 'Bearer tg-1', model: 'meta-llama/Llama-3-8b' }
];

(async () => {
  for (const c of providerCases) {
    calls.length = 0;
    const conn = resolveConnection(c.form);
    const text = await callAI(conn, [{ type: 'text', text: 'hi' }], 16);
    const sent = calls[0];
    assert.strictEqual(new URL(sent.url).host, c.host);
    assert.ok(c.auth(sent.headers), `${c.host} auth header`);
    const sentModel = sent.body.model || decodeURIComponent(sent.url.match(/models\/([^:]+):/)[1]);
    assert.strictEqual(sentModel, c.model);
    assert.ok(text.startsWith('OK from'), `${c.host} parsed reply: ${text}`);
    if (c.host === 'api.together.xyz') assert.ok(sent.url === 'https://api.together.xyz/v1/chat/completions', sent.url);
    if (sent.body.messages) assert.strictEqual(sent.body.max_tokens, 16, `${c.host} caps output tokens`);
  }
  console.log('ok  all 6 providers: endpoint, auth, model and reply parsing verified');

  calls.length = 0;
  for (const [form, check] of [
    [{ userApiKey: 'sk-ant-1' }, b => b.messages[0].content[0].type === 'document'],
    [{ userApiKey: 'sk-proj-1' }, b => b.messages[0].content[0].type === 'file' && b.messages[0].content[0].file.file_data.startsWith('data:application/pdf;base64,')],
    [{ userApiKey: 'AIza1' }, b => b.contents[0].parts[0].inline_data.mime_type === 'application/pdf']
  ]) {
    await callAI(resolveConnection(form), [{ type: 'pdf', base64: 'JVBER' }, { type: 'text', text: 'read' }], 800);
    assert.ok(check(calls[calls.length - 1].body), JSON.stringify(form));
  }
  console.log('ok  resume PDF is sent in each provider\'s own file format');

  await assert.rejects(callAI(resolveConnection({ userApiKey: 'sk-ant-bad' }), [{ type: 'text', text: 'hi' }], 16), /Anthropic \(Claude\): invalid x-api-key/);
  console.log('ok  provider errors are shown with the provider name');

  console.log(`\n${passed + 3} passed`);
})().catch(err => { console.error(err); process.exit(1); });
