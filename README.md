# Study Lab

A free, static study site: 306 quiz questions across Math, Science, History, Geography, English & Vocabulary, and Economics & Finance, with spaced repetition (6 Leitner boxes), confidence ratings, adaptive difficulty, mixed review, and per-subject mastery.

It also has a separate **LSAT prep** section: 50 original LSAT-style questions (32 Logical Reasoning arguments, short and medium, plus 4 Reading Comprehension passage sets covering law, social science, science and humanities). They have five fixed A–E choices, a passage panel that stays beside the questions on wide screens and becomes a short peek with a sticky "Show passage" bar on phones, a "Tempting but wrong" note on every question, short, long and mixed rounds, and an optional count-up pace timer. LSAT is kept out of Mixed review.

- No build step. Plain HTML, CSS and JavaScript modules.
- Progress saves to the browser automatically (localStorage). No login needed.
- Optional: sign in by email link to sync progress across devices (Supabase free tier).
- Design: clean and minimal (off-white #f5f5f7 page, white rounded cards, Inter / Inter Tight with the system San Francisco stack as fallback) with a crisp red accent (#e31937 buttons and highlights, #c8102e for small red text so it passes WCAG AA). A dark mode (black page, near-black cards, #ff5a5f for red text) follows the device setting until you pick one with the Dark/Light button in the top bar; the choice is remembered.
- Browser Back works inside the app: each round has its own address (`#math`, `#mixed`, `#due`, `#lsat/long`, ...). Back from a round returns to the subject list (it asks first if you're partway through), and opening or refreshing a round's address starts a fresh round of that kind.
- Home extras: your weakest topic (with a one-tap practice round), a daily goal (clear today's due reviews or finish one Mixed review), and a "How it works" panel that starts folded on phones.

## Loading and saved data

- `js/lsat.js` (~80 KB) is loaded only when an LSAT round starts (or an `#lsat/...` address is opened). Until then the home page counts LSAT progress straight from your saved data, so nothing is lost or hidden.
- supabase-js is loaded from the CDN only when it's needed: on startup if this browser already has a saved Supabase session (a `sb-<project>-auth-token` entry in localStorage) or is returning from a sign-in link, so signed-in readers still sync automatically. Otherwise it waits until you use the Sync section (focus the email box or press "Email me a link").
- Progress is stored exactly as before under `study-lab-progress-v1`. Preferences use their own keys: `study-lab-theme` ("light" or "dark"), `study-lab-howto`, `study-lab-daily-v1` and `study-lab-lsat-timer`.

## Files

```
index.html          page shell (all paths are relative, so it works under /<repo>/)
config.js           Supabase URL + anon key (blank = local-only, sign-in hidden)
css/styles.css      styles (light + dark mode, phone and laptop); colour tokens at the top
js/theme.js         applies the saved theme before first paint and runs the toggle
og.png              1200x630 share image (regenerate with tests/make-og.mjs)
js/questions.js     the question bank
js/lsat.js          the LSAT bank (Logical Reasoning items + Reading Comprehension passages)
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
   git remote add origin https://github.com/<you>/study-lab.git
   git push -u origin main
   ```
3. In the repo: Settings > Pages > Build and deployment > Source: "Deploy from a branch", Branch: `main`, folder `/ (root)`. Save.
4. After a minute the site is live at `https://<you>.github.io/study-lab/`.

Each later push to `main` redeploys automatically.

## Optional: sync across devices (Supabase, free)

1. Create a free project at https://supabase.com.
2. In the SQL Editor, run `supabase/schema.sql`.
3. Authentication > URL Configuration:
   - Site URL: `https://<you>.github.io/study-lab/`
   - Redirect URLs: add the same URL (and `http://localhost:8000/` if you want to test locally).
4. Project Settings > API: copy the Project URL and the `anon` public key into `config.js`, then commit and push.

The anon key is designed to be public. Row Level Security means each signed-in user can only read and write their own row.

When you sign in, the device's progress and the account's progress are merged: for each question, the most recently answered version wins, and study days are combined, so nothing done offline is lost. After that, every answer syncs a couple of seconds later. Supabase's built-in email sender is rate-limited (a few emails per hour), which is fine for personal use.

## Custom domain later

1. Buy a domain from any registrar.
2. In the repo: Settings > Pages > Custom domain, enter e.g. `study.example.com` and save (GitHub adds a `CNAME` file).
3. At the registrar, add DNS records:
   - Subdomain (`study.example.com`): a `CNAME` record pointing to `<you>.github.io`.
   - Root domain (`example.com`): `A` records to `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`.
4. When DNS has propagated, tick "Enforce HTTPS".
5. If you use sync, update the Supabase Site URL and Redirect URLs to the new domain.

Note: progress in localStorage belongs to each web address, so moving to a new domain starts with empty local progress. Either sign in (sync brings it back) or use Backup and reset > Copy code on the old address and Restore on the new one.

## Adding questions

Append entries to the end of a subject's list in `js/questions.js`:
`[difficulty 1-3, "Subtopic", "Question?", ["Correct", "Wrong", "Wrong", "Wrong"], "Why the answer is right."]`
The first choice is always the correct one (choices are shuffled on screen). Don't reorder or delete existing entries: question IDs are the subject plus position, and saved progress uses them.
