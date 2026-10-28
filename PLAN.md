# Deutsch — German Vocabulary PWA: Build Plan

This is the spec. Read it before starting work. Keep it accurate: when a decision changes, edit the section it belongs to (no change log). Tick the stage checklists in §13 as items are finished, and keep the **Status** line current, because it is how the next session knows where things stand.

**Status:** Stage 1 not started. Next step: Stage 1, first item.

---

## 0. How we work

**The owner** is a native Dutch speaker learning German (about A1). He has **no coding experience** and doesn't read code. He tests on his iPhone and reports back. Talk to him in plain language, briefly, without jargon. He tests each stage but only starts learning for real after the last stage (§13, Launch). Until then, everything stored on his phone is test data.

**You (the agent)** write, test, commit and push everything. Push directly to `main` of `https://github.com/gnobbel/deutsch`. GitHub Pages deploys from `main` (root); the app is live at `https://gnobbel.github.io/deutsch/`.

### Boundaries
- **Always:** decide implementation *and* learning-design details yourself, then tell the owner in one line what you decided · run `npm run check` before every push and never push when it fails · bump the app version on every push that changes any file the service worker caches, word files included (§12.4) · work on one stage at a time · end each stage with a short report and a phone test checklist (below).
- **Ask first:** after launch, anything that could lose or corrupt the owner's progress · removing something the owner already uses · a data source whose license is unclear.
- **Never:** commit secrets, tokens or personal data (the repo is public) · commit raw third-party word lists (§4.1) · change stored data without a migration after launch (§12.3) · delete or weaken a failing test to make the check pass · add a build step or framework to the app.

### Verifying your own work
Don't report something as done because it looks done. Each stage has "Done when" checks (§13); show the evidence (test output, e2e result, a screenshot at iPhone size) in your report. Unit tests alone are not enough. The e2e test must drive the real app in a browser the way the owner would.

Before reporting a stage as done, have a **fresh subagent** review the stage's changes against this plan. Ask it to report only gaps that affect correctness or the stated requirements, not style preferences, and fix those.

### End-of-stage report to the owner
Two or three sentences on what changed and what you decided on his behalf, then **5–10 concrete things to try on the phone**. Before launch, say whether his test data was reset. After launch, if an update touches stored data, remind him to make a backup before opening the new version.

**Real use beats the spec.** His test feedback during the build can already change the plan. Once he learns daily (after launch), his experience decides what gets built next. If something in this plan turns out not to matter in practice, propose dropping it.

---

## 1. Goal and principles

**Goal:** a personal German vocabulary app that teaches words well enough to use them, from beginner to C1. It works offline on an iPhone as a home-screen web app.

**Learning principles**
- **Typing is the core.** The main exercise is Dutch prompt → type the German word, with its article for nouns. Multiple choice is only an on-ramp for new words.
- **One card per word by default.** Extra card types are added only where they test something the core card doesn't.
- **The article is part of the word.** "der Handy" is a wrong answer.
- **Spaced repetition (FSRS)** schedules everything.
- **Most frequent words first**, but **confusable words are never introduced together** (same closed set, or opposites).
- **Every word has an example sentence**, which also gives context on the prompt and enables cloze cards later.
- **Dutch-specific help:** flag false friends, and point out where Dutch de/het doesn't predict der/die/das. All hints and UI text are in Dutch.
- **The learner can overrule the machine** ("Ik had gelijk", §7.5).
- **Workload stays sustainable.** It's better to slow down new words than to build a review backlog.
- **No AI in the app.** Sentence practice happens in any AI chat, using a copied word list (§11.1).

**Why this card model** (short version, for when you're tempted to change it): productive recall (L1 → L2) is the best single exercise, but each direction trains its own skill (Webb 2009; Steinel et al. 2007), so production is the core and recognition is added where it isn't free. Typed recall beats multiple choice for spelling (Nakata 2016). Cognates are easy for a Dutch speaker, so recognition cards are only worth it for non-cognates (de Groot & Keijzer 2000, plus our own inference). Introducing related words together causes lasting mix-ups (Nakata & Suzuki 2019). Spacing beats massing even though it feels worse, which is why learning steps are spread out within a session.

**UI principles**
- Quiet, minimal card UI. No mascots, streaks, confetti or decorative animation.
- Monochrome. Color is used **only** for grammatical gender, and only after answering.
- **Nothing on the prompt side may hint at the answer:** no gender color, icon, German article or audio. The one exception is the first-letter hint for ambiguous prompts (§4.2 `showInitial`).

---

## 2. Decisions already made (don't reopen unless the owner asks)

- Word order is **purely frequency-based**; there's no course to follow. "Leer dit als volgende" lets the owner pull a word forward.
- **No native-speaker check.** Word data is checked by script against Wiktionary plus one fresh-subagent review per band (§4.3). That's enough.
- **No AI inside the app**, no API keys, no network requests besides loading its own files.
- **No separate gender card.** A wrong article counts as a wrong answer on the production card. Revisit only if the stats show articles are the main cause of lapses.
- **No in-app word editor.** Wrong data is reported from the app and fixed in the repo (§11.2).
- One **Start** button, no timed session modes. Endless practice arrives in Stage 4.
- Daily new-word limit **10**. Desired retention **0.90**. Advanced cards unlock at production stability **≥ 21 days**.
- Recognition cards only for non-cognates and false friends.
- Verb forms: the present-tense stem change and the Perfekt; the Präteritum only for *sein*, *haben*, *werden* and the modal verbs.
- German audio plays automatically after each answer.
- UI language is Dutch.

---

## 3. Technical constraints

- Progressive web app in **plain HTML/CSS/JavaScript** (ES modules). No framework, no bundler, no build step: GitHub Pages serves the files as they are. Dev tooling (tests, Playwright) is fine, as long as the app never loads it.
- Third-party code in the app only as vendored single files in `/vendor/`, with a compatible license (e.g. MIT), and only when clearly worth it. The likely candidate is FSRS (`ts-fsrs` browser build).
- Served from a **subpath** (`/deutsch/`): every path is relative (`./`), and the manifest's `start_url`/`scope` and the service-worker scope must work under it.
- **Fully offline** after the first load.
- **All progress lives on the phone in IndexedDB.** Nothing personal leaves the device except when the owner copies a list or exports a backup himself. Call `navigator.storage.persist()` on first run.
- Targets: iOS Safari as a home-screen app (primary); desktop Brave/Chrome (secondary).

### Commands (create these in Stage 1; keep CLAUDE.md in sync)
- `npm run serve`: serves the repo so the app runs at `http://localhost:8080/deutsch/`, like on GitHub Pages.
- `npm test`: unit tests (`node --test`) and the data validator.
- `npm run e2e`: Playwright. Loads the app at the subpath at iPhone size (WebKit if available, otherwise Chromium), runs a short session, checks offline reload, and fails on console errors.
- `npm run check`: everything above, plus the version-bump check (`tools/check-version.js`, §12.4). Must pass before every push.

### File layout (starting point; adjust if there's a good reason)
```
index.html  style.css  manifest.json  sw.js
app.js            – routing, screens, glue
db.js             – IndexedDB, migrations, backup/restore
srs.js            – FSRS wrapper, card states, queue building
session.js        – session flow, learning steps, new-word selection
grading.js        – answer normalisation and checking (pure, unit-tested)
cards.js          – rendering of each card type
lists.js          – word lists, copy list, reports (§11)
tts.js            – speech synthesis
strings.nl.js     – all UI text (Dutch)
words/            – word data by band (words-0001-0500.json, …)
fonts/ icons/ vendor/
tests/            – unit + e2e tests
tools/            – rank, validate, crosscheck, simulate scripts (never loaded by the app)
tools/sources/    – downloaded third-party files; gitignored
```

---

## 4. Word data

### 4.1 Scope and sources
- **Launch with ~2,000 words** (≈ B1), built in bands of 500 across the stages (§13); at 10 a day that lasts over six months. Later, if the owner asks, add bands of 500 toward ~5,000 (B2/C1), **ahead of use**, so there are always at least ~300 words he hasn't seen yet. Home shows how many new words are left, so the owner can say when it's getting low.
- **Order comes from a frequency list, computed by script** (`tools/rank.js`), never estimated from memory. Prefer a list that is already **lemmatised** (ranked by base form), such as the DeReWo base-form list, so *ist/war/bin* don't count separately. SUBTLEX-DE is the fallback; then merge inflected forms into lemmas in the script. Record the source's name, version and download date in `tools/SOURCES.md`. If you can't download the file yourself (no network access, license click-through), ask the owner to download it once and tell him exactly where to put it.
- `level` (A1/A2/B1…) comes from the Goethe lists if they're available locally, otherwise from the rank band.
- **Licensing:** commit only our own compiled data (rank number, translations, sentences). Raw third-party files stay in `tools/sources/`, which is gitignored.
- **Function words with a clean Dutch equivalent** (maar → aber, omdat → weil, zonder → ohne) get normal cards.
- **Slippery function words** (doch, mal, ja as a particle, es, sich, pronouns, articles, *sein* as an auxiliary…) get `"clozeOnly": true`. They're skipped until cloze cards exist (Stage 4).
- **Fixed phrases** are their own entries with `"pos": "phrase"` (*es gibt*, *Lust haben*, *eine Entscheidung treffen*, *Bescheid sagen*). Only use phrases with one natural fixed form, and prioritise the ones where Dutch habits mislead (*een beslissing nemen*). Place them near the rank of their key word.
- Leave out proper nouns and abbreviations. Common multi-meaning words get **one entry per meaning** (*Bank* = bench / bank).

### 4.2 Schema (one object per word)
```json
{
  "id": 214, "rank": 214, "level": "A1", "pos": "noun",
  "de": "Handy", "article": "das", "plural": "Handys",
  "nl": ["mobiele telefoon", "mobieltje", "gsm"], "nlArticle": "de",
  "example": { "de": "Mein [[Handy]] ist schon wieder kaputt.", "nl": "Mijn mobieltje is alweer kapot." },
  "acceptAlso": [], "showInitial": false, "falseFriend": null,
  "cognate": true, "groups": [], "check": false
}
```
- `id`: stable and unique, **never renumbered or reused**. Progress is keyed on it.
- `nl`: accepted Dutch translations; **the first one is the prompt**.
- `nlArticle`: `"de"`, `"het"` or `null`.
- `example.de`: a short, natural, level-appropriate sentence with the target marked `[[…]]` in its exact inflected form. Separable verbs get two markers: `Ich [[fange]] morgen [[an]].` `example.nl` is a natural translation; on the prompt it disambiguates the Dutch word.
- `acceptAlso`: other German words valid for this Dutch prompt (target *schön*, prompt *mooi* → `["hübsch"]`; *bekommen* → `["kriegen", "erhalten"]`). **Fill this generously.** For every word, ask "what else might a learner reasonably type?" Common Dutch verbs are the worst cases (*kijken* → schauen/sehen/gucken). A correct answer marked wrong is the most likely daily annoyance.
- `showInitial`: `true` when the sentence alone can't disambiguate the prompt; the prompt then shows the first letter.
- `falseFriend`: `null` or `{ "nl": "mist", "note": "Duits Mist = mest/rommel; Nederlands mist = Nebel" }` (in Dutch).
- `cognate`: `true` if a Dutch speaker recognises the German word on sight (Haus, trinken, gut); `false` otherwise (bekommen, eigentlich, Mädchen). False friends are always `false`. Decides whether a recognition card is created.
- `groups`: labels for **closed confusable sets** (`weekdays`, `months`, `numbers`, `colors`, `family`, `directions`…) and opposites (`opp:links-rechts`). Not for loose themes like "food". Allowed labels are listed in the validator.
- `check`: `true` when anything is uncertain.
- Optional: `clozeOnly`.

By part of speech:
- **Nouns:** `article`, `plural` (`null` if none; `"pluralOnly": true` for *Eltern*); optional `"nDecl": true` + `"genitive": "des Jungen"`.
- **Verbs:** `"strong": true|false` (true for strong, mixed, irregular and stem-changing verbs); `"forms": {"pres3":"fährt","praet":"fuhr","part":"gefahren","aux":"sein"}` (required for strong verbs); `"separable": "an"` or `null`; `"reflexive": true|false`; `"governs": "auf + Akk."` or `null`. If both haben and sein are possible, use the most common one.
- **Adjectives/adverbs:** base form; optional `"comparison": ["gut","besser","am besten"]` if irregular.
- **Phrases:** `de` is the dictionary form (`"eine Entscheidung treffen"`); the example marks the inflected parts.

### 4.3 Generating and checking the data
1. Generate in batches of 100–200 words in rank order.
2. `tools/validate.js` (part of `npm test`): unique ids; required fields per POS; every noun has an article and a plural / `null` / `pluralOnly`; every example has the right number of `[[…]]` markers; strong verbs have `forms`; no duplicate (de, pos, meaning); `groups` labels come from the known list; valid JSON.
3. `tools/crosscheck.js`: compares every article, plural and verb form against a Wiktionary extract (e.g. the kaikki.org German dataset, kept in `tools/sources/`). Resolve each disagreement; set `check: true` on what you can't resolve. Pay attention to nouns whose article changes the meaning (der/das Teil, der/die See).
4. Once per band of 500: a **fresh subagent** that didn't generate the data reviews what scripts can't check: unnatural sentences, wrong or missing Dutch translations, missing `acceptAlso` alternatives, wrong `cognate` flags, missing `groups`. Ask it for real errors only. Fix them.

Word files are split by band, loaded lazily and all cached by the service worker. Corrections the owner reports (§11.2) are fixed directly in these files. Every change to a word file needs a version bump (§12.4), or the phone keeps the old file.

---

## 5. Cards

| Card type | Prompt → answer | Applies to | Graded | Created | Stage |
|---|---|---|---|---|---|
| **production** (core) | Dutch word + Dutch sentence → type German (with article) | all except `clozeOnly` | auto | when introduced | 2 |
| **recognition** | German word in German sentence → recall meaning → reveal → self-grade | `cognate: false` | self | when introduced; first due the next day; low priority | 3 |
| **cloze** | German sentence with blank(s) + Dutch sentence → type the exact form | all words | auto | production stability ≥ 21 days; `clozeOnly` words when introduced | 4 |
| **plural** | singular with article → type the plural | nouns with a plural | auto | production stability ≥ 21 days | 4 |
| **verbforms** | infinitive → er/sie/es present form, Partizip II, haben/sein (+ Präteritum for sein/haben/werden/modals) | strong verbs | auto | production stability ≥ 21 days | 4 |

Each card has its own FSRS schedule. Cards for established words come rarely, so the advanced cards add little daily load.

**General rules**
- **Siblings rule:** at most one card per word per day. When one card of a word has been reviewed today, its other due cards move to tomorrow. Learning steps within a session are exempt.
- **Daily cap on new cards for existing words:** whenever many already-learned words get a new card at once (many crossing the 21-day unlock on the same day, recognition cards switched back on in Settings, or a card type added after launch), create them **gradually**: at most 10 per day (a fixed number, not a setting), lowest-rank words first, introduced like new cards and counted in Home's minute estimate. Never create them all at once, which would make hundreds due on the same day. All card types ship before launch, so no catch-up between stages is needed.
- **Leech:** ≥ 6 lapses → "leech" badge in the Wankel list. Not suspended automatically.
- Each card can be suspended or reset from the word detail screen (Stage 3).

---

## 6. Learning flow

### 6.1 Choosing new words
- Next words in rank order, skipping `clozeOnly` words until Stage 4.
- Words queued with **"Leer dit als volgende"** go first, within the daily limit.
- **Confusable-set rule:** skip a word that shares a `groups` label with a word introduced today or still in learning. It keeps its place (in practice: one weekday per day).

### 6.2 A new word in a session
1. **Intro card:** Dutch word, German lockup (§10.4), example sentence (DE + NL), gender color and icon, audio, false-friend and de/het notes. Buttons: **Verder** · **Te makkelijk**.
2. **Multiple choice (once):** 4 German options with the same POS and similar rank. For nouns, all options have articles, and one distractor is **the same noun with a wrong article**. A miss (including the wrong-article option) shows the intro again, and the multiple choice comes back later in the session.
3. **Typing step 1:** after at least 3 other cards.
4. **Typing step 2:** after at least 8 other cards, or near the session's end.
5. Two correct typings → the card **graduates** to review. A miss in a typing step → multiple choice once more, then typing again.

If the session ends first, the word stays in learning and continues at the start of the next session.

**"Te makkelijk"** asks for **one typed answer** with the intro hidden. Correct (article included) → it skips learning and goes to review with an Easy first rating (its recognition card too, if it has one), and **doesn't count toward the daily limit**. Otherwise → the normal learning steps.

**Words marked known** (word detail, Stage 3) skip the intro and go straight to review with a moderate initial stability.

**Lapse** (a review answered wrong): show the correct answer, require retyping it, add one relearning typing step later in the session, then return to review.

**Learned** = production card in review. **Established** = production stability ≥ 21 days and no lapse in the last 30 days.

---

## 7. Grading (grading.js: pure functions, fully unit-tested)

### 7.1 Normalisation
- Trim, collapse spaces, Unicode NFC, typographic apostrophes → plain ones.
- **Ignore capitalisation** (setting, default on). The correct form is always shown afterwards.
- **Umlaut shortcuts** (setting, default on): `ae/oe/ue/ss` count as `ä/ö/ü/ß`, with a small note showing the proper spelling. Implement this on the **target side**: compare the input against the target with its ä/ö/ü/ß written out as ae/oe/ue/ss. **Never rewrite the typed input**, because many words genuinely contain these letter pairs (*dass*, *essen*, *Wasser*, *teuer*, *aktuell*) and would then be marked wrong.

### 7.2 Outcomes (checked in this order; first match wins)
| Outcome | When | Effect |
|---|---|---|
| **Correct** | exact match after normalisation (incl. the article for nouns) | Good |
| **Different valid word** | matches `acceptAlso`, or another word whose `nl` contains the prompt | neutral message ("Goed Duits woord, maar we zoeken een ander"), no grade, try again; the first letter is shown on the second try |
| **Wrong (real word)** | the input is a different German word in the dataset (base form, plural or listed verb form), e.g. *Hand* for *Handy* | Wrong. Typo tolerance must never reward a real mix-up |
| **Almost** | Damerau-Levenshtein distance 1, word length ≥ 4, and not an umlaut/ß difference | highlight the difference, retype, **Hard** |
| **Wrong** | anything else, including umlaut/ß errors and a wrong or missing article | show the answer (article in its gender color), retype, **Again** |

### 7.3 Word types
- Separable verbs are typed as one word ("anfangen"). Reflexive verbs are accepted with or without "sich". For verbs with a preposition or case, only the verb is required. The full pattern is always shown on reveal.
- Plural card: "Stühle" and "die Stühle" both count; umlauts matter.
- Verbforms: each field is checked separately (the typo rule applies per field), and all must be right for Good. The present form is accepted with or without er/sie/es.
- Cloze: the exact inflected form(s) between the markers.
- Phrases: the whole phrase in dictionary form, articles included; at most one typo across the phrase.

### 7.4 Self-graded cards (recognition)
Two large buttons, **Vergeten** (Again) / **Onthouden** (Good); keys ← / →; swipe. Optional Easy via ↑ or long-press. **Grades are never inferred from response time.**

### 7.5 "Ik had gelijk"
After Wrong or Almost, this button re-grades the answer as Good and **accepts that answer for that word from then on** (stored locally). It shows what will be accepted ("Vanaf nu wordt *kriegen* ook goed gerekend"). It is **not offered** when the only difference is an umlaut/ß or the article: those are exactly the errors the app should correct. Every use is also added to the reports list (§11.2), so the fix ends up in the repo data.

### 7.6 Required unit tests (examples, not exhaustive)
Noun inputs include the article unless a test is about the article itself.

`"das handy"` (ignore caps) → correct · `"Muede"` for `müde` → correct + note · `"Schon"` for `schön` → wrong · `"das Hnady"`, `"das Hndy"` → almost · `"das Hand"` for `das Handy` → wrong (real word) · `"der Stahl"` for `der Stuhl` → wrong (real word) · `"das Ei"` for `das Eis` → wrong (too short for tolerance) · `"der Handy"` → wrong · `"Handy"` without article → wrong · `"die Strasse"` → correct + note `die Straße` · `"das Wasser"`, `"dass"`, `"teuer"`, `"aktuell"`, `"essen"` → correct (genuine ss/ue, shortcut must not interfere) · `"hübsch"` for `schön` → different valid word · `"kriegen"` for `bekommen` → different valid word · `"freuen"` for `sich freuen` → correct · `"Stühle"` / `"die Stühle"` on the plural card → correct · `"Stuhle"` → wrong · `"faehrt"` / `"er fährt"` in the verbforms present field → correct · "Ik had gelijk" not offered after `"Schon"` for `schön` or after `"der Handy"`.

---

## 8. Scheduling and sessions

### 8.1 FSRS
- **FSRS v5 or later** with default parameters; vendor an established implementation and check its license. Desired retention is a setting (default 0.90, range 0.80–0.95).
- **Let the library own all card state and intervals.** `session.js` only decides *when within a session* a card is shown again (§6.2), never what its schedule becomes. **The library's own short-term (learning/relearning) steps are turned off**, because the session handles those steps itself: during the new-word flow, the intro and multiple-choice answers are logged but not rated, and FSRS gets **one** rating when the word graduates (Good) or passes Te makkelijk (Easy). A lapse is rated Again once, when it happens; the relearning typing step afterwards is session-only and not rated. The few extra rules (siblings, confusable sets, the overdue pause) each live in one named, tested function.
- Grades: Again, Hard (only from Almost), Good, Easy (only from the secondary action and Te makkelijk).
- **Review log** of every answer: card id, timestamp, grade, typed answer, ms.
- **Day boundary at 04:00 local time.**
- **Simulation:** `tools/simulate.js` runs a simulated learner for 90 days (10 new words a day, realistic error rate, some skipped days). At the end of Stage 2, and after any scheduling change, report to the owner in plain language: reviews and minutes per day over time, retention, and anything odd.

### 8.2 Sessions
Progress is saved after every answer, so stopping at any time loses nothing.
- **Start:** due learning/relearning cards first, then due reviews (production → recognition → advanced cards; lowest retrievability first). **One new word after about every 4 reviews** until today's new words are done (immediately if nothing is due). Card types are interleaved. When everything is done: a short **"Klaar voor vandaag"** screen (cards done, time spent, button to copy today's words).
- **Eindeloos** (Stage 4): after today's work, keep practising Shaky words and reviewing ahead. **Practice only, doesn't change schedules**, but misses make a word Shaky. Also a **"+5 nieuwe woorden"** button.
- An exit button ends any session cleanly.
- Home shows due cards and an estimate in minutes (median seconds per card type from the review log; defaults until there's data: production 12 s, recognition 6 s, cloze 15 s, plural 8 s, verbforms 20 s, new word 60 s).
- **Reviews first:** if more than ~30 minutes of reviews are overdue, new words pause, with a one-line explanation on Home.

---

## 9. Screens

Bottom tab bar, monochrome, three tabs: **Leren** · **Woorden** · **Instellingen**. All text in `strings.nl.js`.

- **Leren (Home):** due count + minutes, new words today, **Start** (and **Eindeloos** from Stage 4); a quiet stats line (words learned · reviews today · 30-day retention; no streaks); new words left in the data; backup reminder when the last backup is > 7 days old (dismissible for a day); "Update beschikbaar" when a new version is waiting. On first run: a short screen saying to add the app to the home screen first and only use it from there, and that deleting the icon deletes all progress.
- **Session:** the card flow, a thin count-based progress bar, an exit button, an audio on/off toggle.
- **Woorden** (Stage 3): **Kopieer woorden** at the top (§11.1); tabs **Recent** (introduced in the last 14 days) · **Gevestigd** (established) · **Wankel** (lapse in the last 14 days, ≥ 3 lapses, or missed in Endless; leeches badged); search across all words. **Word detail:** lockup, example, cards with state and next due date, and the actions suspend / reset / mark known / leer dit als volgende / meld fout. **Meldingen** section (§11.2).
- **Instellingen:** daily new-word limit (with "≈ 20–30 min per dag na een paar maanden" next to it, from the simulation) · desired retention · recognition cards on/off · ignore capitalisation · umlaut shortcuts · audio voice, speed, auto-play · backup / restore · reset everything (double confirmation) · app version.

---

## 10. UI spec

### 10.1 Visual base
- Background light `#F7F6F2`, dark `#141619`; off-white text in dark mode. Follows the system setting.
- Font: **Atkinson Hyperlegible**, self-hosted woff2 (OFL). Verify ä ö ü ß render. Fallback: Inter, system-ui.
- The main word sits at the **same fixed position** on every card.
- Primary buttons at the bottom, in thumb reach. Respect safe areas (`viewport-fit=cover`, `env(safe-area-inset-*)`).
- Motion: a short fade at most; respect `prefers-reduced-motion`.

### 10.2 Gender colors (after answering only)
- **der = blue · die = orange-red · das = teal-green**, starting from Okabe-Ito (`#0072B2`, `#D55E00`, `#009E73`). Adjust for ≥ 4.5:1 contrast on both backgrounds, with lighter variants in dark mode.
- Paired with shapes: der ■ · die ● · das ▲. The article text is always shown; color and icon only support it.
- On reveal, the article and a thin card border take the gender color.
- **de/het note** when Dutch het ↔ German not das, or Dutch de ↔ German das ("NL: het meisje → DE: das Mädchen", "NL: de zon → DE: die Sonne"). Shown on the intro and on every reveal of that noun.

### 10.3 Card layout
1. **Context sentence** (18px, muted): Dutch sentence with the prompt word bold on production; German sentence with the target bold on recognition; German with a blank and the Dutch below on cloze.
2. **Word** (32px, bold) at the fixed position.
3. **Info bar** (14px), **after reveal only**: forms, part of speech, audio button.

### 10.4 Lockups (revealed side)
- Noun: `der Stuhl · die Stühle`. n-declension: `der Junge · des Jungen · die Jungen`.
- Strong verb: `fahren · er fährt · ist gefahren`, with the Präteritum smaller in the info bar.
- Separable verb: the prefix as a detached pill, `[an] fangen`, with the example showing the split.
- With case/preposition: `helfen + Dat.`, `warten auf + Akk.`, `sich freuen auf + Akk.`
- Phrase: the whole phrase, plus the Dutch-trap note if any ("NL: een beslissing *nemen*").
- False friend: a short Dutch note under the lockup ("Let op: Mist ≠ mist").

### 10.5 Input
- Answer field: `autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false" enterkeyhint="done"`, font-size ≥ 16px (prevents iOS zoom).
- **Key row ä ö ü ß** directly above the iOS keyboard (positioned with `visualViewport`), inserting at the cursor.
- Enter submits; after a reveal, Enter continues. On the laptop, ← / → / ↑ for self-graded cards.

### 10.6 Audio
- `speechSynthesis` with a `de-DE` voice; prefer names containing "Enhanced"/"Premium"/"Erweitert". Voice and speed in Settings, with a hint on downloading an Enhanced German voice in iOS (Instellingen → Toegankelijkheid → Gesproken materiaal → Stemmen).
- **Never on the prompt side.** Plays automatically after each answer (default on) and on the intro card; the info bar has a replay button.

---

## 11. Getting text out of the app

### 11.1 Kopieer woorden
One tap copies a plain list of recent words, which the owner pastes into any AI chat with his own request.
- Selector: **Vandaag** · **Afgelopen 7 dagen** (default) · **Afgelopen 30 dagen** · **Wankel**; the choice is remembered. Also a shortcut on "Klaar voor vandaag" (today's words).
- Format: one word per line, German – Dutch, nothing else. Nouns with article, verbs as infinitive (separable as one word, reflexive with *sich*, preposition if any). Toggle **met Nederlandse betekenis** (default on).
  ```
  der Stuhl – stoel
  anfangen – beginnen
  sich freuen auf – zich verheugen op
  ```
- Clipboard API with "Gekopieerd ✓" feedback; fallback: share sheet or a selectable text box.

### 11.2 Meldingen (reporting data errors)
There's no in-app editor. Instead:
- **"Meld fout"** on every revealed card and on the word detail screen adds the word to a local reports list, with an optional short note ("verkeerd lidwoord?").
- Every "Ik had gelijk" is added to the same list automatically.
- **Kopieer meldingen** (Woorden tab) copies the list as plain text (word id, German, Dutch, what happened, note). The owner pastes it into Claude Code, which fixes the word files, and then clears the list in the app.
- Answers accepted through "Ik had gelijk" keep working locally whether or not the repo is updated, and can be undone from the word detail screen.

---

## 12. Storage, backup, updates

### 12.1 IndexedDB stores
- `cards`: `{ id: "214:production", wordId, type, fsrs, suspended: bool, step, leech }`. `fsrs` is the FSRS library's card object, stored whole and unchanged (state new/learning/review/relearning, stability, difficulty, due, last review, reps, lapses and any other fields the library keeps), so it always round-trips through the library. `suspended` is a separate flag: suspending never touches `fsrs`, so unsuspending restores the card exactly as it was.
- `reviewLog`: `{ cardId, ts, grade, answer, ms, practice: bool }`
- `words`: `{ wordId, introducedOn, tooEasy, knownMarked, queuedNext, accepted: [] }` (`accepted` holds answers allowed through "Ik had gelijk")
- `reports`: `{ wordId, ts, kind: "override|report", answer, note }`
- `settings`, `meta` (`schemaVersion`, `lastBackup`, `appVersion`, copy-list choice)
- `snapshots`: the last 3 automatic snapshots (taken before migrations and imports)

### 12.2 Backup and restore
- **Export:** `deutsch-backup-YYYY-MM-DD.json` with all stores except snapshots. JSON turns dates into plain text, so export and import must convert every date (including the FSRS `due` and last-review fields and review-log timestamps) back to real dates, and the round-trip test must check that they come back as dates, not text. On iOS, use `navigator.share` with a File so it can be saved to iCloud Drive in two taps; fall back to a download.
- **Import:** validate, migrate if older, show a summary (words, cards, date), take a snapshot, then **replace after confirmation**.

### 12.3 Data updates and migrations
- Progress is keyed on word `id`. New words simply appear. A word removed from the data keeps its progress, hidden.
- **After launch:** every change to the shape of stored data bumps `schemaVersion` and adds a tested migration. Snapshot first. No exceptions.
- **Before launch** the owner's data is test data: a change may instead bump `schemaVersion` and cleanly clear the old data on the next start (the app must not break on it), and the stage report says so. The migration machinery itself is still built and tested in Stage 1.

### 12.4 Service worker and updates
- Precache the app shell, fonts, icons and all word files under a versioned cache name (`deutsch-vX.Y.Z`). **One version constant, bumped on every push that changes any file the service worker caches** (code, styles, `vendor/`, fonts, icons, manifest and every file in `words/`), also shown in Settings. Delete stale caches on activate.
- `tools/check-version.js` (part of `npm run check`) fails when any cached file differs from `origin/main` while the version constant doesn't, and when a file in `words/` is missing from the precache list.
- Cache-first for app files.
- **Never reload mid-session.** A new version shows "Update beschikbaar" on Home; it applies on tap, or at the next cold start.

### 12.5 iOS notes
- The home-screen app has **separate storage** from Safari tabs, and deleting the icon deletes all progress. The README and first-run screen say both.
- Manifest: `display: standalone`, name "Deutsch", colors from §10.1, icons including a 180px `apple-touch-icon`.

---

## 13. Build stages

One stage per session. Start each stage by planning it against this section, then build, verify and report. Tick items as they're done. A stage is done only when every "Done when" check passes and the evidence is in the report.

### Stage 1 — Foundation
- [ ] Repo bootstrap: this file as `PLAN.md`, `CLAUDE.md`, README (one paragraph + iPhone install steps), `.gitignore` (incl. `tools/sources/`, `node_modules/`)
- [ ] `package.json` with the commands from §3; Playwright as a dev dependency
- [ ] PWA shell, manifest, icons, self-hosted font, service worker with the update flow
- [ ] IndexedDB layer with migrations, snapshots, backup export/import
- [ ] Three-tab navigation (placeholder screens are fine), Settings basics, first-run install screen
- [ ] `tools/rank.js`, `tools/validate.js`, `tools/crosscheck.js`, `tools/SOURCES.md`
- [ ] **Words 1–500**, validated, crosschecked and reviewed (§4.3)

*Done when:* `npm run check` passes · e2e shows the app working offline at `/deutsch/` · an e2e test changes the version and confirms the update applies without losing stored data · a backup → reset → restore round trip restores identical data (test) · crosscheck report has no unresolved disagreements · the owner has installed it on his iPhone.

### Stage 2 — Daily learning
- [ ] `grading.js` with all tests from §7.6
- [ ] FSRS (vendored), production card, review log, day boundary
- [ ] New-word flow: intro → multiple choice → two typing steps; Te makkelijk; confusable-set rule
- [ ] Lapses and relearning; siblings rule; overdue pause
- [ ] Start session with new words mixed in; "Klaar voor vandaag" (copy button can come in Stage 3)
- [ ] "Ik had gelijk" with its safeguards (local `accepted` list)
- [ ] Key row, audio after answering, gender colors, lockups, de/het and false-friend notes
- [ ] Home: due count, minutes, new words left
- [ ] `tools/simulate.js` and the 90-day report

*Done when:* `npm run check` passes · an e2e test introduces a new word, completes its learning steps and sees it graduate · the backup → reset → restore test is rerun with real FSRS cards and review-log entries, and confirms dates come back as dates and the same cards are due before and after · the simulation report has been shared with the owner and looks sensible · the owner has tried a full session on his phone.

### Stage 3 — Words tab, copy list, recognition
- [ ] Recognition cards for non-cognates, with the daily cap when switched back on in Settings (§5)
- [ ] Woorden tab: Kopieer woorden, Recent / Gevestigd / Wankel, search, word detail with its actions
- [ ] Meld fout + Meldingen list + Kopieer meldingen
- [ ] Leeches; Home stats line; backup reminder
- [ ] **Words 501–1,000** with the checks from §4.3

*Done when:* `npm run check` passes (incl. copy-list format tests) · e2e: copy a word list, report a word, copy the reports · a test with a few hundred already-learned words and recognition cards switched back on shows new recognition cards stay within the daily cap · the simulation, rerun with recognition cards, still looks sensible.

### Stage 4 — Advanced cards and Endless
- [ ] Cloze, plural and verbforms cards with the 21-day unlock and the daily cap (§5); `clozeOnly` words via cloze
- [ ] Eindeloos with practice and "+5 nieuwe woorden"
- [ ] **Words 1,001–2,000** in bands of 500, each with the checks from §4.3

*Done when:* `npm run check` passes · the simulation still looks sensible with the new card types, including days when many words cross the 21-day unlock at once.

### Launch — the owner starts learning for real
- [ ] Backup and restore work from Instellingen on the iPhone: a backup saved to iCloud Drive restores correctly
- [ ] Tell the owner to use "reset everything" in Instellingen so he starts without test progress
- [ ] Set the Status line to "Launched". From here on the migration rule (§12.3) and the backup reminder before data-changing updates apply in full.

*Done when:* the owner has reset his test data, made his first backup, and started his first real session.

---

## 14. Out of scope and later ideas

**Out of scope:** accounts, syncing between devices, any AI or network feature in the app, gamification (streaks, points, badges), Android-specific work, a build step.

**Later, only if the owner asks or real use shows a need:** words 2,001–5,000 (and whether low-frequency words should be recognition-first) · a placement test · the owner's own words (separate id range) · FSRS parameter optimisation from the review log · a separate gender drill · Präteritum for all strong verbs · compound-word dividers · a statistics page with a review forecast · a forecast on "+5 nieuwe woorden".
