# New LinkedIn Outreach

A Chrome extension that writes short, personalized LinkedIn connection notes from the profile you're viewing. It works for free with a built-in template, or with your own AI key from Anthropic, OpenAI, Gemini, OpenRouter, Groq or any OpenAI-compatible service.

## Install

1. Clone this repo.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick the repo folder.
4. Open a LinkedIn profile, click the extension icon, then **Generate**.

To use AI Mode, paste an API key under **Settings** and click **Test**. Use the switch in the header to move between AI Mode and Free Mode. Your key stays saved.

## Key changes

The original version often wrote broken notes: quotes cut off mid-word, a headline passed off as a "recent post", and tenure shown as the company. Most of this came from two root causes. The scraper misread LinkedIn's page, and the template cut text without checking where. For each bug, I reproduced it with the old code on real profile data, fixed the cause, and added a test.

### Better notes
- **No cut-off text.** The template never cuts text. A post is quoted only if its first sentence fits; otherwise the note says "I enjoyed your recent post".
- **Fits LinkedIn's 300-character limit.** Notes are built from pieces. When a note is too long, whole pieces are dropped in order: the pitch is shortened to one sentence, then the resume offer goes, then the pitch. The counter turns red if you edit a note past 300.
- **Your pitch is used as written.** The bio is now a one-line pitch of up to 150 characters.

### Correct profile data
- **Recent post is a real post.** `parseActivity` skips the line after the author's name, lines that repeat on every post card, and the person's name and headline.
- **Company is right.** `parseExperience` labels each line as a date, a tenure, a location or text, instead of assuming a fixed order. This handles both of LinkedIn's layouts: single roles, and several roles grouped under one company.
- **Headline is found again.** It's read from LinkedIn's headline element, with a fallback to the line under the name on post cards.

### New features
- **Choose the opener.** Every hook found (shared skill or employer, recent post, role, past company) appears under **Open with**. Click one to rewrite the note around it.
- **Resume is actually used.** The AI reads your PDF once and keeps only a pitch, your skills, and your employers and schools. These create "we both…" openers. The PDF itself isn't stored.
- **Any AI provider.** The provider is detected from the key. Each provider is one entry in the `PROVIDERS` table in `utils/providers.js`, and one `callAI` function sends every request.
- **AI Mode switch.** Turn AI Mode off without deleting your key, which makes it easy to compare the two modes.
- **Custom message type.** Write your own ask when Networking, Job, Referral and Collaboration don't fit.
- **Tell the AI what to change.** Type "shorter" or "make it warmer" and press **Rewrite**.
- **Offer your resume.** An optional line for Job and Referral notes.

### Removed
- **Deep Mode (3-Layer AI).** It claimed to use OpenAI and search company news. In fact it ran the same code as Quick Mode, plus a 300 ms delay. There is now one **Generate** button.
- **Regenerate without a key.** The template always gives the same text, so Regenerate only appears in AI Mode.

### Fixes
- **OpenRouter "requested 65536 tokens" error.** Only Anthropic requests sent a token limit. Every OpenAI-compatible request now sends `max_tokens`.
- Scraping returns you to where you were on the page.
- Removed dead code, unneeded delays and a duplicated 300-character constant.

## Tests

```sh
node test/run.js
```

27 tests cover the profile parsers, the note builder, the AI Mode switch, and all six providers against a fake network.

## Privacy

Without a key, everything runs in your browser. With a key, profile text and your resume go only to the AI provider you chose.
