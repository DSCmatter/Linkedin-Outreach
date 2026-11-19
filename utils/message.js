'use strict';

const NOTE_LIMIT     = 300;
const POST_QUOTE_MAX = 80;

function firstSentence(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  const m = s.match(/^.+?[.!?](?=\s|$)/);
  return (m ? m[0] : s).trim();
}

function lower(xs) { return (xs || []).map(x => String(x).toLowerCase().trim()); }

function listJoin(xs) { return xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0]; }

// A hook is one concrete reason to reach out. `line` is the sentence that opens the message.
function buildHooks(p, me = {}) {
  const hooks = [];

  const theirSkills = lower(p.skills);
  const sharedSkills = (me.resumeSkills || []).filter(s => theirSkills.includes(String(s).toLowerCase().trim())).slice(0, 2);
  const theirCompanies = lower([p.currentCompany, ...(p.pastCompanies || [])].filter(Boolean));
  const sharedCompany = (me.resumeCompanies || []).find(c => theirCompanies.includes(String(c).toLowerCase().trim()));
  if (sharedCompany) {
    hooks.push({ id: 'shared-company', label: `Both at ${sharedCompany}`, line: `I noticed we've both spent time at ${sharedCompany}.` });
  }
  if (sharedSkills.length) {
    hooks.push({ id: 'shared-skills', label: `Shared: ${sharedSkills.join(', ')}`, line: `I noticed we both work with ${listJoin(sharedSkills)}.` });
  }

  if (p.recentPosts && p.recentPosts.length) {
    const quote = firstSentence(p.recentPosts[0]);
    hooks.push({
      id: 'post',
      label: 'Recent post',
      line: quote.length <= POST_QUOTE_MAX ? `I enjoyed your recent post: "${/[.!?]$/.test(quote) ? quote : quote + '.'}"` : 'I enjoyed your recent post.'
    });
  }

  if (p.currentTitle && p.currentCompany) {
    hooks.push({ id: 'role', label: `${p.currentTitle} at ${p.currentCompany}`, line: `I came across your work as ${p.currentTitle} at ${p.currentCompany}.` });
  } else if (p.currentCompany) {
    hooks.push({ id: 'role', label: `At ${p.currentCompany}`, line: `I came across your work at ${p.currentCompany}.` });
  }

  if (p.skills && p.skills.length >= 2) {
    const two = p.skills.slice(0, 2);
    hooks.push({ id: 'skills', label: `Skills: ${two.join(', ')}`, line: `Your experience in ${listJoin(two)} caught my attention.` });
  }

  if (p.pastCompanies && p.pastCompanies.length) {
    hooks.push({ id: 'past', label: `Ex-${p.pastCompanies[0]}`, line: `I saw you were previously at ${p.pastCompanies[0]}.` });
  }

  if (!hooks.length) {
    hooks.push({ id: 'profile', label: 'Your profile', line: 'I came across your profile and would like to connect.' });
  }
  return hooks;
}

function pitchSentence(pitch) {
  const t = String(pitch || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const body = /^(i|i'm|i’m|my)\b/i.test(t) ? t : `A bit about me: ${t}`;
  return /[.!?]$/.test(body) ? body : `${body}.`;
}

const GREETING = { Formal: n => `Dear ${n},`, Neutral: n => `Hi ${n},`, Casual: n => `Hey ${n}!` };
const CLOSING  = { Formal: 'Kind regards,', Neutral: 'Best,', Casual: 'Cheers,' };

function asSentence(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const capped = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

function askLine(messageType, company, customAsk) {
  if (messageType === 'Custom') return asSentence(customAsk) || `I'd love to connect.`;
  const co = company ? ` at ${company}` : '';
  return {
    Networking:    `I'd love to connect and exchange ideas.`,
    Job:           `I'm exploring opportunities${co} and would value a quick chat.`,
    Referral:      `If you're open to it, I'd be grateful for guidance on roles${co}, or a referral if I seem a fit.`,
    Collaboration: `I think there's a real chance for us to collaborate and would love to explore it.`
  }[messageType] || `I'd love to connect.`;
}

// Builds the free-mode note. Optional parts are dropped, never cut mid-word, until it fits.
function composeMessage(p, hook, { messageType, tone, customAsk, userName, userBio, offerResume }) {
  const greet  = (GREETING[tone] || GREETING.Neutral)(p.firstName);
  const close  = CLOSING[tone] || CLOSING.Neutral;
  const me     = (userName || '').trim();
  const ask    = askLine(messageType, p.currentCompany, customAsk);
  const offer  = offerResume && (messageType === 'Job' || messageType === 'Referral') ? ' Happy to share my resume if useful.' : '';

  const fullPitch  = pitchSentence(userBio);
  const shortPitch = pitchSentence(firstSentence(userBio));
  const variants = [
    [fullPitch, offer],
    [shortPitch, offer],
    [fullPitch, ''],
    [shortPitch, ''],
    ['', '']
  ];

  const render = ([pitch, off]) =>
    `${greet}\n\n${hook.line}${pitch ? ' ' + pitch : ''}\n\n${ask}${off}\n\n${close}${me ? '\n' + me : ''}`;

  const candidates = variants.map(render);
  return candidates.find(m => m.length <= NOTE_LIMIT) || candidates[candidates.length - 1];
}

function recipientJSON(p) {
  return JSON.stringify({
    name: p.name, headline: p.headline, title: p.currentTitle, company: p.currentCompany,
    about: (p.about || '').slice(0, 400), recentPost: (p.recentPosts || [])[0] || null, skills: p.skills
  });
}

function notePrompt(p, { hook, messageType, tone, customAsk }, s) {
  const purpose = messageType === 'Custom' ? `Custom. The sender's goal: ${customAsk || 'connect'}` : messageType;
  const offer = s.offerResume && (messageType === 'Job' || messageType === 'Referral');
  return `Write a LinkedIn connection note. Hard limit: ${NOTE_LIMIT} characters including line breaks.
Purpose: ${purpose}. Tone: ${tone}.
Open with this angle: ${hook.line}
Recipient: ${recipientJSON(p)}
Sender name: ${s.userName || '(not given)'}. Sender pitch: ${s.userBio || '(not given)'}.
Sender skills from resume: ${(s.resumeSkills || []).join(', ') || '(not given)'}.
${offer ? 'End by offering to share a resume.' : ''}
Never quote text cut off mid-sentence. Return only the message text.`;
}

function refinePrompt(p, { message, instruction }, s) {
  return `Here is a LinkedIn connection note the sender wants changed.
<note>
${message}
</note>
Sender's instruction: ${instruction}
Recipient, for context: ${recipientJSON(p)}
Sender name: ${s.userName || '(not given)'}. Sender pitch: ${s.userBio || '(not given)'}.
Apply the instruction and keep everything else the same. Hard limit: ${NOTE_LIMIT} characters including line breaks.
Return only the rewritten note.`;
}
