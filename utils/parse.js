'use strict';

const DATE_RANGE  = /\b(19|20)\d{2}\b|\bpresent\b/i;
const TENURE_ONLY = /^(?:(?:full|part)-time|self-employed|freelance|internship|contract|apprenticeship|seasonal)?\s*·?\s*\d+\s*(?:yrs?|mos?)\b/i;
const LOCATION    = /,|\bremote\b|\bon-?site\b|\bhybrid\b/i;

function lineKind(line) {
  if (line === undefined) return 'end';
  if (TENURE_ONLY.test(line) && !DATE_RANGE.test(line)) return 'tenure';
  if (DATE_RANGE.test(line) && line.length < 80) return 'dates';
  if (line.length > 100 || /^skills:/i.test(line)) return 'detail';
  return 'text';
}

// LinkedIn renders two experience layouts in the same list:
//   single role:  Title, Company · Full-time, Jan 2020 - Present · 4 yrs, [Location]
//   grouped:      Company, Full-time · 8 yrs 11 mos, [Role, dates, [Location]]...
function parseExperience(lines) {
  const kinds   = lines.map(lineKind);
  const entries = [];
  let group = null;

  for (let i = 0; i < lines.length; i++) {
    if (kinds[i] !== 'text') continue;
    const afterDates = kinds[i - 1] === 'dates' || kinds[i - 1] === 'tenure';
    const isGroupLocation = group && afterDates && LOCATION.test(lines[i]) && lines[i].length < 60;
    if (isGroupLocation) continue;

    if (kinds[i + 1] === 'tenure') {
      group = lines[i];
      i += 1;
    } else if (kinds[i + 1] === 'dates' && group) {
      entries.push({ title: lines[i], company: group, duration: lines[i + 1] });
      i += 1;
    } else if (kinds[i + 1] === 'text' && kinds[i + 2] === 'dates') {
      group = null;
      entries.push({ title: lines[i], company: lines[i + 1].split('·')[0].trim(), duration: lines[i + 2] });
      i += 2;
    }
  }
  return entries;
}

// Every card in the Activity section repeats the author's name and headline above the
// post body, so any line that appears on more than one card is chrome, not post content.
function parseActivity(lines, { name, headline } = {}) {
  const counts = new Map();
  lines.forEach(l => counts.set(l, (counts.get(l) || 0) + 1));
  const posts = [];
  for (const [i, l] of lines.entries()) {
    if (counts.get(l) > 1 || l === name || l === headline || lines[i - 1] === name) continue;
    if (l.length <= 40 || l.length >= 1500) continue;
    if (/\b(reposted|commented|liked|followers|connections?)\b|dialog|window|escape|premium|people you may|you might/i.test(l)) continue;
    if (!posts.includes(l)) posts.push(l);
  }
  return posts;
}

// On each activity card the author's headline sits on the line right after their name.
function headlineFromActivity(lines, name) {
  const counts = new Map();
  lines.forEach((l, i) => {
    const next = lines[i + 1];
    if (l === name && next && next !== name && next.length > 15) counts.set(next, (counts.get(next) || 0) + 1);
  });
  let best = null;
  for (const [l, c] of counts) if (!best || c > counts.get(best)) best = l;
  return best;
}

// Strips the unread-notification count "(3) " that LinkedIn puts in the tab title, and
// pronouns people add to their name, like "Manoj G (He/Him/His)".
function cleanName(raw) {
  return String(raw || '')
    .replace(/^\(\d+\+?\)\s*/, '')
    .replace(/\s*\((?:he|she|they|him|her|them|his|hers|theirs|xe|ze)\b[^)]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameFromTitle(title) {
  return cleanName(String(title || '').split('|')[0]);
}

function extractFromHeadline(headline, field) {
  if (!headline) return null;
  const atMatch = headline.match(/^(.+?)\s+(?:at|@)\s+(.+?)(?:\s*[|·].*)?$/i);
  if (atMatch) return field === 'title' ? atMatch[1].trim() : atMatch[2].trim();
  return null;
}
