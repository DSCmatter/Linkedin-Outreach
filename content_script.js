'use strict';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'scrapeProfile') {
    scrapeWithScroll().then(profile => {
      sendResponse({ success: true, data: profile });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }
});

async function scrapeWithScroll() {
  const startY = window.scrollY;
  window.scrollTo(0, 800);  await wait(500);
  window.scrollTo(0, 1600); await wait(500);
  window.scrollTo(0, 2400); await wait(600);
  window.scrollTo(0, startY);
  return scrapeProfile();
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function scrapeProfile() {
  const clean = (str) => (str || '').replace(/\s+/g, ' ').trim();

  function getSection(heading) {
    return Array.from(document.querySelectorAll('section')).find(s =>
      s.querySelector('h2')?.innerText?.trim().toLowerCase().includes(heading.toLowerCase())
    ) || null;
  }

  function leafTexts(root, selector, minLen = 3) {
    if (!root) return [];
    return Array.from(root.querySelectorAll(selector))
      .filter(el => el.children.length === 0)
      .map(el => clean(el.innerText))
      .filter(t => t.length >= minLen && !/^[·•\s]+$/.test(t));
  }

  const name = cleanName(document.querySelector('h1')?.innerText) ||
               nameFromTitle(document.title);

  const topCard = document.querySelector('h1')?.closest('section') || null;
  const activityLines = leafTexts(getSection('Activity'), 'p, span', 3);

  // ── HEADLINE ──────────────────────────────────────────────────────────────
  // The classic layout keeps the headline in .text-body-medium. The redesigned one uses
  // plain <p>s; there the headline also follows the author's name on each activity card.
  const topLines = leafTexts(topCard, 'p, div.text-body-medium', 6).filter(t => t !== name);
  const headline =
    clean(topCard?.querySelector('.text-body-medium')?.innerText) ||
    headlineFromActivity(activityLines, name) ||
    topLines.find(t => t.includes('|') || t.includes('@')) ||
    null;

  // ── LOCATION ──────────────────────────────────────────────────────────────
  const location = topLines.find(t =>
    t !== headline && t.includes(',') && t.length < 60 && !t.includes('|') && !t.includes('@')
  ) || null;

  // ── ABOUT ─────────────────────────────────────────────────────────────────
  const about = leafTexts(getSection('About'), 'p, span').find(t => t.length > 80) || null;

  // ── EXPERIENCE ────────────────────────────────────────────────────────────
  const expLines = leafTexts(getSection('Experience'), 'p, span[aria-hidden="true"]')
    .filter(t => t !== 'Experience');
  const experienceEntries = parseExperience([...new Set(expLines)]);

  const currentEntry   = experienceEntries[0] || null;
  const currentTitle   = currentEntry?.title   || extractFromHeadline(headline, 'title');
  const currentCompany = currentEntry?.company || extractFromHeadline(headline, 'company');
  const pastCompanies  = [...new Set(
    experienceEntries.map(e => e.company).filter(c => c && c !== currentCompany)
  )];

  // ── SKILLS ────────────────────────────────────────────────────────────────
  const skills = [...new Set(leafTexts(getSection('Skills'), 'p, span').filter(t =>
    t !== 'Skills' && t.length < 60 &&
    !/\d|follower|connection|endorse|show all|see all|dialog|window|escape/i.test(t)
  ))];

  // ── EDUCATION ─────────────────────────────────────────────────────────────
  const eduLines = leafTexts(getSection('Education'), 'p').filter(t => t !== 'Education');
  const educationEntries = [];
  for (let i = 0; i < eduLines.length; i += 3) {
    educationEntries.push([eduLines[i], eduLines[i + 1]].filter(Boolean).join(', '));
  }

  // ── RECENT POSTS ──────────────────────────────────────────────────────────
  const recentPosts = parseActivity(activityLines, { name, headline });

  return {
    name,
    headline,
    currentTitle,
    currentCompany,
    location,
    about,
    recentPosts:       recentPosts.slice(0, 3),
    experienceEntries: experienceEntries.slice(0, 5),
    pastCompanies:     pastCompanies.slice(0, 4),
    educationEntries:  educationEntries.slice(0, 3),
    skills:            skills.slice(0, 10),
    profileUrl:        window.location.href.split('?')[0]
  };
}
