# Study Lab

A free, static study site: 480 questions across Math, Science, History, Geography, English & Vocabulary, and Economics & Finance, with spaced repetition (6 Leitner boxes), confidence ratings, adaptive difficulty, mixed review, and per-subject mastery. Besides multiple choice, every subject has Recall, Explain why, Put in order, Match and short Reading questions (see Question formats below), plus 24 short **Study** lessons to read and review (see Study lessons below).

It also has a separate **LSAT prep** section: 75 original LSAT-style questions (29 Logical Reasoning arguments, short and medium; 7 Reading Comprehension passage sets with 36 questions covering law, criminology, social science, science, archaeology and humanities, two of which double as Study lessons; and 10 skill drills on conditional logic, assumptions, flaws and question types in the new formats). LSAT multiple choice questions have five fixed A–E choices, a passage panel that stays beside the questions on wide screens and becomes a short peek with a sticky "Show passage" bar on phones, a "Tempting but wrong" note on every question, short, long and mixed rounds, and an optional count-up pace timer. LSAT is kept out of Mixed review.

- No build step. Plain HTML, CSS and JavaScript modules.
- Progress saves to the browser automatically (localStorage). No login needed.
- Optional: sign in by email link to sync progress across devices (Supabase free tier).
- Design: clean and minimal (off-white #f5f5f7 page, white rounded cards, Inter / Inter Tight with the system San Francisco stack as fallback) with a crisp red accent (#e31937 buttons and highlights, #c8102e for small red text so it passes WCAG AA). A dark mode (black page, near-black cards, #ff5a5f for red text) follows the device setting until you pick one with the Dark/Light button in the top bar; the choice is remembered.
- Browser Back works inside the app: each round has its own address (`#math`, `#mixed`, `#due`, `#lsat/long`, ...). Back from a round returns to the subject list (it asks first if you're partway through), and opening or refreshing a round's address starts a fresh round of that kind.
- Home extras: your weakest topic (with a one-tap practice round), a daily goal (clear today's due reviews or finish one Mixed review), and a "How it works" panel that starts folded on phones.

## Question formats

Rounds mix formats so you don't just recognise answers but pull them out of memory. About 3 in every 10 new questions in a round are one of the practice formats, and a round includes at most one short reading set (its questions stay together). Each subject has 13 of them: 5 Recall, 2 Explain why, 2 Put in order, 1 Match and a 3-question reading passage.

- **Recall**: type the answer. Producing an answer (rather than picking one) is the strongest form of retrieval practice. Small typos are accepted for longer words, numbers can be written as fractions, decimals or with a $ sign, and if your wording means the same thing you can press "I was right, count it". Start typing from anywhere; Enter checks.
- **Explain why**: write a sentence or two, then compare it with a model answer and its key points, and grade yourself (1 I had it, 2 Partly, 3 Missed it). Explaining why something is true (self-explanation) builds understanding that transfers. "Partly" counts as a guess, so the question comes back sooner. Ctrl+Enter (⌘+Enter) shows the model answer.
- **Put in order**: arrange steps, events or sizes with the ↑ ↓ buttons (the moved item keeps focus, and each move is announced to screen readers). Sequencing builds the cause-and-effect structure that makes facts easier to remember.
- **Match**: choose a term, then its meaning (or the other way round); pairs share a number. Contrasting related ideas side by side helps you tell them apart.
- **Reading**: a short passage beside 3 questions (multiple choice), to practise understanding and applying ideas, not just recalling them.

Confidence (Sure / Think so / Guessing) is asked for every format except Explain why, which you grade after seeing the model answer.

## Feedback after each answer

Every question (all 555, every format, LSAT and Study lessons included) has extra context beyond its explanation:

- a **topic tag** naming the area and subtopic (for example "Grammar • Dangling modifiers");
- **Why your answer was wrong**: for multiple choice, a note specific to the option you picked;
- **Key idea**: the concept behind the question in a sentence or three, defining any jargon, with a small example;
- **How to improve**: a concrete study tip.

After a wrong answer all of it is shown under the verdict. After a right answer you see the topic, and the key idea and tip are folded under "More context". The verdict and explanation stay in the `role="status"` callout, so screen readers announce just that; the extra sections follow it in reading order. The round summary groups what you missed by topic, with a tip for each ("Topics to work on").

## Study lessons

The **Study** section on the home page lists 26 short lessons by subject: 4 each in Math, Science, History, Geography, English and Economics, plus 2 LSAT Reading Comprehension passages. Each is a 2–4 minute read on one idea, written for someone new to it.

- A lesson opens on its own address (`#study/study-sci-1`). Key terms are highlighted where they first appear and defined in a Key terms box (beside the text on wide screens, after it on phones).
- **Check my understanding** runs the lesson's 4 questions (5 for LSAT) with the lesson beside them; on phones a sticky "Show lesson" bar reopens it. Every answer gets the full feedback above (topic, why your answer was wrong, key idea, tip).
- Lesson questions are ordinary cards (`<subject>-s<n>`, LSAT `lsat65`–`lsat74`), so they join spaced repetition, levels, Due review, sync and backups. Lesson passages also count as reading sets, so Mixed and subject rounds bring in passage questions more often.
- A lesson is ticked off ("Studied") when you finish its check, or with the **Mark as studied** toggle. That tick is stored on this device under `study-lab-studied-v1`; a lesson whose questions are all answered also shows as studied on any synced device.

## Loading and saved data

- `js/lsat.js` (~95 KB) is loaded only when an LSAT round starts (or an `#lsat/...` address is opened). Until then the home page counts LSAT progress straight from your saved data, so nothing is lost or hidden.
- `js/lessons.js` (lesson text, ~70 KB) loads the first time a lesson opens or a round includes lesson questions. Lesson titles and questions are in `js/study.js`, which loads with the page. If the text can't load (offline), the lesson says so and rounds leave lesson questions out.
- `js/context/<subject>.js` (the feedback above, ~20–60 KB each) loads in the background when a round starts, only for the subjects in that round. If it can't load (offline), feedback falls back to the explanation alone.
- supabase-js is loaded from the CDN only when it's needed: on startup if this browser already has a saved Supabase session (a `sb-<project>-auth-token` entry in localStorage) or is returning from a sign-in link, so signed-in readers still sync automatically. Otherwise it waits until you use the Sync section (focus the email box or press "Email me a link").
- Progress is stored exactly as before under `study-lab-progress-v1`. Questions in the new formats are ordinary cards in the same store (same `{b, due, n, k, t}` shape), and earlier IDs are unchanged, so existing progress carries over as it is. Preferences use their own keys: `study-lab-theme` ("light" or "dark"), `study-lab-howto`, `study-lab-daily-v1`, `study-lab-lsat-timer` and `study-lab-studied-v1`.

## Files

```
index.html          page shell (all paths are relative, so it works under /<repo>/)
config.js           Supabase URL + anon key (blank = local-only, sign-in hidden)
css/styles.css      styles (light + dark mode, phone and laptop); colour tokens at the top
js/theme.js         applies the saved theme before first paint and runs the toggle
js/menu.js          the Menu dropdown in the top bar (lists the page's sections), built from the page's h2/h3 headings (on hover, keyboard focus or a finger sliding across, an entry smoothly grows slightly with red text on a soft red pill; colour only with reduced motion)
og.png              1200x630 share image (regenerate with tests/make-og.mjs; the question count comes from the banks. Then update the count in index.html's og/twitter descriptions and bump ?v= on og:image so link previews refresh)
js/questions.js     the question bank (multiple choice)
js/practice.js      Recall / Explain why / Put in order / Match questions and the short reading passages, per subject
js/lsat.js          the LSAT bank (Logical Reasoning items, Reading Comprehension passages, skill drills)
js/study.js         Study lessons: titles, topics and their questions (correct answer first)
js/lessons.js       Study lesson text and key terms (loaded on demand)
js/context/*.js     per-question feedback extras (topic, key idea, why each wrong option is wrong, tip), one file per subject
lsat-research.md    LSAT format research and the integration plan
js/engine.js        spaced repetition, levels, session building, merge logic (no DOM)
js/sync.js          optional Supabase sync (loads supabase-js from a CDN only when configured)
js/app.js           the UI
supabase/schema.sql progress table + Row Level Security policies
tests/              engine tests, headless smoke test, review screenshots (review.mjs), og image maker
.nojekyll           tells GitHub Pages to serve files as-is
```

## Run locally

```
python3 -m http.server 8000
# open http://localhost:8000
```

(Opening index.html straight from disk won't work, because browsers block JS modules on file:// URLs.)

## Deploy free on GitHub Pages

1. Create a new public repository on GitHub, for example `study-lab`.
2. Upload the contents of this folder (index.html at the top level of the repo), or push it:
   ```
   git init && git add . && git commit -m "Study Lab"
   git branch -M main
   git remote add origin https://github.com/liamsmith059/study-lab.git
   git push -u origin main
   ```
3. In the repo: Settings > Pages > Build and deployment > Source: "Deploy from a branch", Branch: `main`, folder `/ (root)`. Save.
4. After a minute the site is live at `https://liamsmith059.github.io/study-lab/`.

Each later push to `main` redeploys automatically.

## Optional: sync across devices (Supabase, free)

1. Create a free project at https://supabase.com.
2. In the SQL Editor, run `supabase/schema.sql`.
3. Authentication > URL Configuration:
   - Site URL: `https://liamsmith059.github.io/study-lab/`
   - Redirect URLs: add the same URL (and `http://localhost:8000/` if you want to test locally).
4. Project Settings > API: copy the Project URL and the `anon` public key into `config.js`, then commit and push.

The anon key is designed to be public. Row Level Security means each signed-in user can only read and write their own row.

When you sign in, the device's progress and the account's progress are merged: for each question, the most recently answered version wins, and study days are combined, so nothing done offline is lost. After that, every answer syncs a couple of seconds later. Supabase's built-in email sender is rate-limited (a few emails per hour), which is fine for personal use.

## Custom domain later

1. Buy a domain from any registrar.
2. In the repo: Settings > Pages > Custom domain, enter e.g. `study.example.com` and save (GitHub adds a `CNAME` file).
3. At the registrar, add DNS records:
   - Subdomain (`study.example.com`): a `CNAME` record pointing to `liamsmith059.github.io`.
   - Root domain (`example.com`): `A` records to `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`.
4. When DNS has propagated, tick "Enforce HTTPS".
5. If you use sync, update the Supabase Site URL and Redirect URLs to the new domain.

Note: progress in localStorage belongs to each web address, so moving to a new domain starts with empty local progress. Either sign in (sync brings it back) or use Backup and reset > Copy code on the old address and Restore on the new one.

## Adding questions

Append entries to the end of a subject's list in `js/questions.js`:
`[difficulty 1-3, "Subtopic", "Question?", ["Correct", "Wrong", "Wrong", "Wrong"], "Why the answer is right."]`
The first choice is always the correct one (choices are shuffled on screen). Don't reorder or delete existing entries: question IDs are the subject plus position, and saved progress uses them.

Practice formats go at the end of a subject's list in `js/practice.js` (IDs are `<subject>-x<position>`, so append only):

```
{ type: "typed",   d: 2, t: "Algebra", q: "Solve for x: 3x − 7 = 11", a: ["6"], num: 6, e: "Why." }        // a: accepted answers; num/tol for numbers
{ type: "explain", d: 2, t: "Topic", q: "Why ...?", a: "Model answer.", k: ["Key point", "Key point"], e: "Short note." }
{ type: "order",   d: 1, t: "Topic", q: "Put these in order ...", items: ["First", "Second", "Third"], e: "Why." }  // listed in the correct order
{ type: "match",   d: 1, t: "Topic", q: "Match each ...", pairs: [["Term", "Meaning"], ["Term", "Meaning"]], e: "Why." }
{ type: "mc",      d: 2, t: "Topic", p: "passage-id", q: "According to the passage ...", c: ["Correct", "Wrong", "Wrong", "Wrong"], e: "Why." }
```

Reading passages live in `EXTRA_PASSAGES` in the same file (`{ title, area, paras: [...] }`). Keep order items free of dates or other giveaways.

Every new question also needs an entry in `js/context/<subject>.js`, keyed by its ID (the tests check this):

```
eng30: { tp: "Grammar • Dangling modifiers", c: "Key idea, defining any jargon, with a tiny example.",
         w: [, "Why option 1 is wrong", "Why option 2 is wrong", "Why option 3 is wrong"], tip: "How to improve." },
```

`w` is for multiple choice only and is indexed like the question's own choices (index 0, the correct one, stays empty). For an LSAT item, a missing `w` slot for its trap answer falls back to the item's "Tempting but wrong" note.

New Study lessons go at the end of `STUDY_LESSONS` in `js/study.js` (`{ key, s, title, topic, t, qs: [{ d, q, c, e }] }`, correct choice first), with their text in `js/lessons.js` (`{ paras, terms: [[term, definition]] }`; inside a paragraph `\n` starts a new line and `- ` lines become a list) and a context entry for each question. Question IDs are numbered in lesson order per subject, so only append.
