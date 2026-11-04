# Deutsch — German Vocabulary PWA: Build Plan

This is the spec. Read it before starting work. Keep it accurate: when a decision changes, edit the section it belongs to (no change log). Tick the stage checklists in §13 as items are finished, and keep the **Status** line current, because it is how the next session knows where things stand.

**Status:** Stage 2 built and verified (v0.2.0); owner feedback added in v0.2.1 (levels with "te makkelijk", example sentence behind "Toon zin") and v0.3.0 (real CEFR levels from the Goethe lists, everyday words first, 138 new words incl. 18 phrases, prompt hints, hard-word cap, word families) and v0.4.0 (words 639–1,000: the Stage 3 word band is done) and v0.5.0 (words 1,001–1,500, the first Stage 4 band: 669 A1, 527 A2, 299 B1 words in total; no Goethe A1 word missing) and v0.6.0/v0.6.1 (owner feedback: context sets such as naar → zu / nach with the sentence as the prompt, 5 "naar" phrases; levels: "Ik begin bij", the quick scan instead of typed checks, "Dit niveau lijkt te makkelijk"). v0.8.0 (owner request): Quizlet-style practice, keeping the FSRS schedule underneath: Home has Herhalen, Leren (rounds of 7 words from a chosen level: multiple choice, then typed, then gekend, with a summary per round) and Toets (a scored test of a level's learned words), and each level shows gekend · bezig · nieuw (§2, §6.2–§6.4, §9). v0.7.0: a learning review against research and measurements (Te makkelijk checked after 3 other cards; a word missed while learning graduates with Hard; grading ignores end punctuation and accepts `variants` such as *gerne*; plural and verb forms named; the hint after a different valid word shows where the words part; the review log records why an answer was wrong; toasts no longer block taps). Waiting for the owner to try a full session on his iPhone (last "Done when" check; Stage 1's install check is still open too). Next: several rotating example sentences per context-set word (agreed with the owner, §4.2), then Stage 3, first item.

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
- **Every word has an example sentence**, which gives context on request ("Toon zin") and enables cloze cards later.
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

- Word order is **frequency weighted by CEFR level, with everyday words first** (owner request, v0.3.0; §4.1); there's no course to follow. "Leer dit als volgende" lets the owner pull a word forward.
- **No native-speaker check.** Word data is checked by script against Wiktionary plus one fresh-subagent review per band (§4.3). That's enough.
- **No AI inside the app**, no API keys, no network requests besides loading its own files.
- **No separate gender card.** A wrong article counts as a wrong answer on the production card. Revisit only if the stats show articles are the main cause of lapses (the review log records `reason: "article"` since v0.7.0).
- **No in-app word editor.** Wrong data is reported from the app and fixed in the repo (§11.2).
- **Quizlet-style practice (owner request, v0.8.0):** the owner liked Quizlet's Learn and Test modes and missed two things here: a sense of progress, and choosing which words to study. So Home has **Herhalen** (the daily reviews), **Leren** (rounds of 7 words from a level he chooses, multiple choice → typed → gekend, a summary after each round) and **Toets** (a scored typed test of a level's learned words), with each level's progress (gekend · bezig · nieuw). The FSRS schedule stays underneath (owner's choice). This replaced the intro card, the 3/8-card learning gaps and the single **Start** button. No timed session modes. Endless practice arrives in Stage 4.
- Daily new-word limit **10**. Desired retention **0.90**. Advanced cards unlock at production stability **≥ 21 days**.
- Recognition cards only for non-cognates and false friends.
- Verb forms: the present-tense stem change and the Perfekt; the Präteritum only for *sein*, *haben*, *werden* and the modal verbs.
- German audio plays automatically after each answer.
- UI language is Dutch.
- **Levels (owner request, v0.2.1, reworked v0.6.0):** words are grouped into levels of 100 by rank; the owner can mark a level "te makkelijk" (one at a time, all below a start level, or when the app offers it after 5 known words in a row), and its unseen words are then **scanned** in a tap list instead of coming as new words (§6.1).
- **Context sets (owner request, v0.6.0):** where one Dutch word has several German translations and grammar decides (naar → zu / nach, voor → für / vor, maar → aber / nur / sondern), the Dutch sentence is the prompt, the other word of the set is a real mistake, and the rule is shown (§4.2 `contextSet`).
- **Example sentence hidden by default (owner request, v0.2.1):** cards show just the word, with a small "Toon zin" button; a setting shows it always (§10.3).

---

## 3. Technical constraints

- Progressive web app in **plain HTML/CSS/JavaScript** (ES modules). No framework, no bundler, no build step: GitHub Pages serves the files as they are. Dev tooling (tests, Playwright) is fine, as long as the app never loads it.
- Third-party code in the app only as vendored single files in `/vendor/`, with a compatible license (e.g. MIT), and only when clearly worth it. **Decided (Stage 2):** `vendor/ts-fsrs.js` is ts-fsrs 5.4.2 (`dist/index.mjs`, MIT, no dependencies; renamed to `.js` so every server sends it as JavaScript), license in `vendor/ts-fsrs.LICENSE.txt`. 6.0.0 was a day old at the time.
- Served from a **subpath** (`/deutsch/`): every path is relative (`./`), and the manifest's `start_url`/`scope` and the service-worker scope must work under it.
- **Fully offline** after the first load.
- **All progress lives on the phone in IndexedDB.** Nothing personal leaves the device except when the owner copies a list or exports a backup himself. Call `navigator.storage.persist()` on first run.
- Targets: iOS Safari as a home-screen app (primary); desktop Brave/Chrome (secondary).

### Commands (create these in Stage 1; keep CLAUDE.md in sync)
- `npm run serve`: serves the repo so the app runs at `http://localhost:8080/deutsch/`, like on GitHub Pages.
- `npm test`: unit tests (`node --test`) and the data validator.
- `npm run e2e`: Playwright. Loads the app at the subpath at iPhone size (WebKit if available, otherwise Chromium), runs a short session, checks offline reload, and fails on console errors.
- `npm run check`: everything above, plus the version-bump check (`tools/check-version.js`, §12.4). Must pass before every push.
- `node tools/simulate.js`: the 90-day simulation (§8.1); its options are listed at the top of the file.

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
- **Order is computed by script, never estimated from memory.** Frequency comes from `tools/rank.js` and is kept per word as `freq`; `tools/order.js` turns `freq` and `level` into `rank` (the learning order), see below. **Decided (Stage 1):** DeReWo can't be fetched from the agent's machine, so the order comes from the OpenSubtitles 2018 frequency list, with inflected forms merged into base forms by `rank.js` using the LanguageTool/Morphy morphology dictionaries, so *ist/war/bin* count toward *sein*. Sources, versions and download dates are in `tools/SOURCES.md`; `node tools/fetch-sources.js` downloads them.
- `level` (A1/A2/B1/B2/C1) is the lowest Goethe-Institut list (A1, A2, B1) the word is on (`tools/goethe.js`; the lists are used locally only, see `tools/SOURCES.md`), otherwise our judgment, checked in the per-band review. It means *how advanced* a word is; how hard it is *for a Dutch speaker* is a separate, computed score (§6.1).
- **Learning order (`tools/order.js`, decided v0.3.0 at the owner's request):** subtitles alone put *König, töten, Waffe* before *Brot, Tisch, Montag*. So `rank` = order by `freq` × level weight (A1 0.5 · A2 0.9 · B1 1.4 · B2 1.8 · C1 2.2), with guarantees on top: the k-th A1 word comes no later than 1.25·k (all A1 in about the first 900), A2 words follow, and a short **core** list (numbers, days, months, seasons, colors, family, food, home, transport, shopping, weather, body, directions, clothes; `CORE_WORDS` in `tools/order.js`) comes within about the first 400. A word never comes before its `base`. `node tools/order.js` reports where words land and which Goethe A1/A2 words are still missing (or deliberately skipped); `--write` renumbers `rank` and re-splits the band files. Ids never change, so renumbering before or after launch never touches progress.
- **Licensing:** commit only our own compiled data (rank number, translations, sentences). Raw third-party files stay in `tools/sources/`, which is gitignored.
- **Function words with a clean Dutch equivalent** (maar → aber, omdat → weil, zonder → ohne) get normal cards.
- **Slippery function words** (doch, mal, ja as a particle, es, sich, pronouns, articles, *sein* as an auxiliary…) get `"clozeOnly": true`. They're skipped until cloze cards exist (Stage 4).
- **Fixed phrases** are their own entries with `"pos": "phrase"` (*es gibt*, *Lust haben*, *eine Entscheidung treffen*, *Bescheid sagen*). Only use phrases with one natural fixed form, and prioritise the ones where Dutch habits mislead (*een beslissing nemen*). Place them near the rank of their key word.
- Leave out proper nouns and abbreviations. Common multi-meaning words get **one entry per meaning** (*Bank* = bench / bank).

### 4.2 Schema (one object per word)
```json
{
  "id": 214, "rank": 214, "freq": 480, "level": "A1", "pos": "noun",
  "de": "Handy", "article": "das", "plural": "Handys",
  "nl": ["mobiele telefoon", "mobieltje", "gsm"], "nlArticle": "de",
  "example": { "de": "Mein [[Handy]] ist schon wieder kaputt.", "nl": "Mijn mobieltje is alweer kapot." },
  "acceptAlso": [], "showInitial": false, "falseFriend": null,
  "cognate": true, "groups": [], "check": false
}
```
- `id`: stable and unique, **never renumbered or reused**. Progress is keyed on it.
- `rank`: the learning order, computed by `tools/order.js`; `freq`: the word's place in the cleaned frequency list (§4.1).
- `nl`: accepted Dutch translations; **the first one is the prompt**.
- `nlArticle`: `"de"`, `"het"` or `null`.
- `nlHint` (optional): a short Dutch hint shown after the prompt, when two words share the same prompt: *waar (plaats)* = wo, *waar (juist)* = wahr; for true synonyms the register (*krijgen (spreektaal)* = kriegen). The validator rejects two learnable words whose prompts look the same (Dutch word, hint and first-letter hint together).
- `base` (optional): the id of a word this one builds on (*Fahrrad* → *fahren*, *Spaß machen* → *Spaß*). It waits until its base has been introduced (§6.1), and its answer side shows "Verwant met: fahren".
- `example.de`: a short, natural, level-appropriate sentence with the target marked `[[…]]` in its exact inflected form. Separable verbs get two markers: `Ich [[fange]] morgen [[an]].` `example.nl` is a natural translation; on the prompt it disambiguates the Dutch word.
- `variants` (optional): other spellings or forms of **this same word** that are simply right: *gerne* for *gern*, *zuhause* for *zu Hause*, *wie geht es* for *wie geht's*, *die Bekannte* for *der Bekannte*, *diese/dieses* for *dieser*, *meine* for *mein* (the Dutch prompt covers all of them). Graded **correct**, with the dictionary form shown ("Ook goed. In het woordenboek: gern"). Never put these in `acceptAlso`: "we zoeken een ander" plus a first letter they share leaves no way out (measured: 43 such entries until v0.7.0). Nouns carry their article.
- `acceptAlso`: other German words valid for this Dutch prompt (target *schön*, prompt *mooi* → `["hübsch"]`; *bekommen* → `["kriegen", "erhalten"]`). **Fill this generously.** For every word, ask "what else might a learner reasonably type?" Common Dutch verbs are the worst cases (*kijken* → schauen/sehen/gucken). A correct answer marked wrong is the most likely daily annoyance.
- `showInitial`: `true` when the sentence alone can't disambiguate the prompt; the prompt then shows the first letter. (The sentence is hidden until "Toon zin"; after a "different valid word" answer it is shown automatically, with the first letter.)
- `falseFriend`: `null` or `{ "nl": "mist", "note": "Duits Mist = mest/rommel; Nederlands mist = Nebel" }` (in Dutch).
- `cognate`: `true` if a Dutch speaker recognises the German word on sight (Haus, trinken, gut); `false` otherwise (bekommen, eigentlich, Mädchen). False friends are always `false`. Decides whether a recognition card is created.
- `groups`: labels for **closed confusable sets** (`weekdays`, `months`, `numbers`, `colors`, `family`, `directions`…) and opposites (`opp:links-rechts`). Not for loose themes like "food". Allowed labels are listed in the validator.
- `check`: `true` when anything is uncertain.
- Optional: `clozeOnly`.
- `contextSet` + `rule` (optional, together): words that share their Dutch prompt where **grammar or context decides** which one is meant (`naar`: zu / nach; `voor`: für / vor; `maar`: aber / nur / sondern; also `of`, `dan`, `zetten`, `sinds`, `achter`, `buiten`, `uur`, `lang`). `rule` is the same short Dutch text on every word of the set, cases separated by ` · ` ("naar een persoon of plek → zu (zum Arzt) · naar een stad of land → nach …"). Such words have no `nlHint` and `showInitial: false`: their **Dutch sentence is the prompt** and is always shown (§10.3); the multiple choice offers the other words of the set; typing another word of the set is Wrong (real word), with the rule highlighted (§7.2); the rule shows when the word is shown after a wrong choice and after every mistake; and the words of a set are confusable (never introduced on the same day, §6.1). Use a set only when the example sentence decides the answer on its own; for real synonyms or meaning differences keep `nlHint`. The validator checks all of this. **Planned next (agreed with the owner):** several example sentences per context-set word, rotating, so the rule is learned rather than one sentence.

By part of speech:
- **Nouns:** `article`, `plural` (`null` if none; `"pluralOnly": true` for *Eltern*); optional `"nDecl": true` + `"genitive": "des Jungen"`.
- **Verbs:** `"strong": true|false` (true for strong, mixed, irregular and stem-changing verbs); `"forms": {"pres3":"fährt","praet":"fuhr","part":"gefahren","aux":"sein"}` (required for strong verbs); `"separable": "an"` or `null`; `"reflexive": true|false`; `"governs": "auf + Akk."` or `null`. If both haben and sein are possible, use the most common one.
- **Adjectives/adverbs:** base form; optional `"comparison": ["gut","besser","am besten"]` if irregular.
- **Phrases:** `de` is the dictionary form (`"eine Entscheidung treffen"`); the example marks the inflected parts.

### 4.3 Generating and checking the data
1. Generate in batches of 100–200 words. Run `node tools/order.js` (its report lists the Goethe A1/A2 words still missing, with where they would land) and `node tools/coverage.js` (frequent lemmas missing), and make sure every word they list is either added or a deliberate skip (see `tools/SOURCES.md`). Then `node tools/order.js --write`.
2. `tools/validate.js` (part of `npm test`): unique ids; required fields per POS; every noun has an article and a plural / `null` / `pluralOnly`; every example has the right number of `[[…]]` markers; strong verbs have `forms`; no duplicate (de, pos, meaning); `groups` labels come from the known list; valid JSON.
3. `tools/crosscheck.js`: compares every article and plural against a Wiktionary extract (gambolputty/german-nouns; kaikki.org is unreachable from the agent's machine) and every verb form and weak/strong flag against the Morphy verb dictionary (see `tools/SOURCES.md`). Resolve each disagreement: fix the word, or record why our value is right in `tools/crosscheck-resolved.json`. Set `check: true` on what you can't resolve. Pay attention to nouns whose article changes the meaning (der/das Teil, der/die See). `haben`/`sein` has no script source; the per-band review checks it.
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
- Next words in rank order, skipping `clozeOnly` words until Stage 4. A word that waits under one of the rules below keeps its place.
- **Hard-word cap:** at most **4 hard new words a day** (fixed). Difficulty for a Dutch speaker is computed, not stored (`difficultyOf` in `session.js`): not a cognate +2 · false friend +2 · noun whose de/het doesn't predict der/die/das +1 · strong verb +1 · separable +1 · reflexive or with a fixed preposition/case +1 · phrase +1 · longer than 10 letters +1; 0–1 easy, 2–3 medium, 4+ hard. A hard word passed with Te makkelijk doesn't count. (Real use adds the true picture later: FSRS difficulty and lapses per word feed the Wankel list.)
- **Word families:** a word with a `base` waits until the base word has been introduced.
- Words queued with **"Leer dit als volgende"** go first, within the daily limit.
- **Chosen level (v0.8.0):** with a level chosen on Home ("Ander niveau", setting `learnLevel`), new words come only from that level (queued words still go first), plus the **base words** its words wait for, however far back (*Großvater* in level 5 brings *Vater* from level 1); "Automatisch" (`null`) follows the normal order across levels. Choosing a level marked too easy asks to unmark it first; a chosen level marked too easy later (Home, Instellingen) means the normal order again. Home's "Vandaag nog *n* nieuwe woorden" picks the words one by one with every rule (confusable sets, hard-word cap, word families, the level), so it is exactly what Leren can give. When the chosen level has no new words left, Home says so and suggests choosing the next one.
- **Confusable-set rule:** skip a word that shares a `groups` label or a `contextSet` with a word introduced today or still in learning. It keeps its place (in practice: one weekday per day). A word marked known in the quick scan (below) doesn't count as introduced.
- **Levels:** level *n* is ranks (n−1)·100+1 … n·100, labelled with the most common CEFR `level` of its words ("Niveau 3 (A1)"). The current level is that of the next new word. Home shows it with "Te makkelijk?"; Instellingen → Niveaus has **"Ik begin bij" A1 / A2 / B1** (marks every level before the first level labelled at or above it; it reads "eigen keuze" when the marked levels match none) and lists every level with a checkbox to mark or unmark it (setting `easyLevels`).
- **"Dit niveau lijkt te makkelijk" (v0.6.0):** when the last **5** words introduced from the current level (not via the scan) all passed Te makkelijk and the level still has new words, the answer side of that 5th pass offers "Rest van niveau *n* overslaan" (marks it at once; the session's next new words come from the next level), and Home shows the same offer instead of the plain "Te makkelijk?" link.
- **A level marked too easy:** its words that weren't introduced yet are no longer new words. They come in the **quick scan** instead (Home → "Snel doorlopen", outside the session): pages of **10** words, German (with article) next to the Dutch prompt; the owner taps the ones he doesn't (surely) know and taps "Volgende". Known → straight to review with an Easy first rating (`levelCheck`, `tooEasy`), not counted toward the daily limit, not blocking confusable words. Not known → a new word again, queued first like "Leer dit als volgende" (`scanMissed`, `queuedNext`), then learned normally and counted. At most **30 scanned words a day** (fixed: the simulation showed 50 a day piles the known words' first reviews into a 30–50-minute week); paused together with new words when reviews are overdue. Each page is stored when "Volgende" is tapped, so stopping loses only the open page. A word marked known that wasn't really known simply lapses at its first review. Unmarking a level makes its unscanned words new words again; scanned words keep their progress. (Until v0.6.0 these words came as typed quick checks; the owner found one-by-one too slow.)

### 6.2 Leren: rounds (v0.8.0, like Quizlet's Learn)
A Leren session works in **rounds** of up to **7 words** (`ROUND_SIZE`): words still in learning first (from any level), then new words from the chosen level, within the daily limit. Each word is asked **once per round**, in shuffled order, never the same word twice in a row (except in a round of one word, where the summary comes in between). After each round: a **summary** (each word with ✓ or ✗, "gekend" for words that are done, and the level's progress bar) with **Volgende ronde** or **Klaar**, and a ✕ to stop. Words that became gekend leave; new words fill the round.

A word's steps:
1. **First question: multiple choice**, before the word has been shown (Quizlet asks straight away): 4 German options with the same POS and similar rank. For nouns, all options have articles, and one distractor is **the same noun with a wrong article**. Also **Weet ik niet** and **Ken ik al**. A wrong choice or Weet ik niet shows the word (German lockup §10.4, example sentence DE + NL, gender color and icon, audio, false-friend and de/het notes; "Dit is het woord" / "Niet goed") with **Verder**; it is a multiple choice again next round. A miss on this very first question is a first look, not a miss.
2. A right multiple choice → **typed** next round (Dutch prompt → German, article included).
3. Typed right (Almost counts, after retyping) → **gekend**: the card graduates to review, rated **Good**, or **Hard** if anything went wrong on the way (a multiple choice after the word was shown, a typed miss, a failed Ken ik al check; stored as `missed` on the card, so it survives the end of a session). A typed miss → the answer is shown and retyped, multiple choice next round, then typed again.

A new word is stored at its **first answer**: stopping halfway leaves the words not answered yet untouched (not started, not counted toward today's limit). A word that was answered stays in learning and continues in the next Leren session.

Spacing: within a round the other words come between a word's questions (about 6 cards with a full round, fewer for the day's last few words: with 10 a day, the last 3 come in a round of 3); the first review follows 2–3 days later (FSRS). One typed step instead of the two before v0.8.0: Rawson & Dunlosky 2011 found extra correct recalls in the first session add little once later reviews follow. Whether it holds for the owner is a check for real data (§14).

**"Ken ik al"** (Te makkelijk) on the first question asks for **one typed answer at the end of a later round, with at least 3 other cards since** (`GAP.check`; oldest first); when the session has no such cards left (the day's last word), the check waits for the next Leren session, and the end screen says so. Not right away, because typing a word you saw two seconds ago tests what is still in short-term memory, not whether you knew it: recall drops sharply within seconds once other material comes in between (Peterson & Peterson 1959), and judgments of "I know this" made right after seeing the answer are much less accurate than delayed ones (Nelson & Dunlosky 1991, the delayed-JOL effect). A passed check skips about two weeks of practice (Easy first rating), so it has to be a real test. Correct (article included) → review with an Easy first rating (its recognition card too, if it has one), and it **doesn't count toward the daily limit** (a word counted today gives its place back; a check left over from an earlier day took no place today). Otherwise → multiple choice next round, then typed. A check that hasn't come yet doesn't count for "Dit niveau lijkt te makkelijk" (§6.1).

### 6.3 Herhalen
Due reviews, lowest retrievability first (§8.2). **Lapse** (a review answered wrong): show the correct answer, require retyping it, add one relearning typing step **5 cards later** in the session, then return to review. A relearning step cut off by the end of a session comes first next time.

### 6.4 Toets (v0.8.0, like Quizlet's Test)
Up to **20** learned words (`TEST_SIZE`) of the level shown on Home, in random order, typed, with the normal feedback and retype after a mistake; at the end a score ("16 van 20 goed") and the words to practise. A Toets answer is a real review for FSRS (which takes a review at any moment), at most one rating per word per day (siblings rule, §5): a word already reviewed today is practice only. A wrong answer is rated Again, without a relearning step (the word comes back tomorrow). Not offered until the level has learned words.

**Words marked known** (word detail, Stage 3) skip learning and go straight to review with a moderate initial stability.

**Learned** = production card in review. **Established** = production stability ≥ 21 days and no lapse in the last 30 days.

---

## 7. Grading (grading.js: pure functions, fully unit-tested)

### 7.1 Normalisation
- Trim, collapse spaces, Unicode NFC, typographic apostrophes → plain ones, and drop sentence punctuation at the end (`.`, `?`, `!`): iOS types ". " on a double space, and phrases like *wie bitte?* invite a question mark. Until v0.7.0 "sein." was Almost and "und." Wrong.
- An article typed with a capital ("Das Haus") is the right article, also when capitalisation counts.
- **Ignore capitalisation** (setting, default on). The correct form is always shown afterwards.
- **Umlaut shortcuts** (setting, default on): `ae/oe/ue/ss` count as `ä/ö/ü/ß`, with a small note showing the proper spelling. Implement this on the **target side**: compare the input against the target with its ä/ö/ü/ß written out as ae/oe/ue/ss. **Never rewrite the typed input**, because many words genuinely contain these letter pairs (*dass*, *essen*, *Wasser*, *teuer*, *aktuell*) and would then be marked wrong.

### 7.2 Outcomes (checked in this order; first match wins)
| Outcome | When | Effect |
|---|---|---|
| **Correct** | exact match after normalisation (incl. the article for nouns), or one of the word's `variants` (shown with the dictionary form) | Good |
| **Different valid word** | matches `acceptAlso`, or another word whose `nl` contains the prompt | neutral message ("Goed Duits woord, maar we zoeken een ander"), no grade, try again; the second try shows the start of the word up to the first letter where the typed word differs (*wa…* after *wieso* for *warum*; one letter when the first letters differ; never the whole word): a quarter of the alternatives (135 of 551) start with the target's letter, so the first letter alone told nothing |
| **Wrong (real word)** | the input is a different German word in the dataset (base form, plural or listed verb form), e.g. *Hand* for *Handy*; also the word's own plural (*die Stühle*: "Dat is het meervoud") or its own conjugated form (*fährt*, *gefahren* for *fahren*: "typ het hele werkwoord"), said as such; also another word of the same context set (*nach* where the sentence needs *zu*), which comes first, before Different valid word, and shows "In deze zin past nach niet" with the set's rule | Wrong. Typo tolerance must never reward a real mix-up |
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
After Wrong or Almost, this button re-grades the answer as Good and **accepts that answer for that word from then on** (stored locally). It shows what will be accepted ("Vanaf nu wordt *kriegen* ook goed gerekend"). It is **not offered** when the only difference is an umlaut/ß or the article, when the answer is the word's own plural or a conjugated form of it, or when the answer is another word of the same context set (§4.2): those are exactly the errors the app should correct. A context-set word that really is right in its sentence goes into `acceptAlso` (seitdem accepts seit), which is checked before the set and counts as a different valid word. Every use is also added to the reports list (§11.2), so the fix ends up in the repo data.

### 7.6 Required unit tests (examples, not exhaustive)
Noun inputs include the article unless a test is about the article itself.

`"das handy"` (ignore caps) → correct · `"Muede"` for `müde` → correct + note · `"Schon"` for `schön` → wrong · `"das Hnady"`, `"das Hndy"` → almost · `"das Hand"` for `das Handy` → wrong (real word) · `"der Stahl"` for `der Stuhl` → wrong (real word) · `"das Ei"` for `das Eis` → wrong (too short for tolerance) · `"der Handy"` → wrong · `"Handy"` without article → wrong · `"die Strasse"` → correct + note `die Straße` · `"das Wasser"`, `"dass"`, `"teuer"`, `"aktuell"`, `"essen"` → correct (genuine ss/ue, shortcut must not interfere) · `"hübsch"` for `schön` → different valid word · `"kriegen"` for `bekommen` → different valid word · `"freuen"` for `sich freuen` → correct · `"Stühle"` / `"die Stühle"` on the plural card → correct · `"Stuhle"` → wrong · `"faehrt"` / `"er fährt"` in the verbforms present field → correct · "Ik had gelijk" not offered after `"Schon"` for `schön` or after `"der Handy"` · `"das Handy."` / `"dass."` → correct (end punctuation) · `"gerne"` for `gern` → correct + dictionary form (variant) · `"die Stühle"` for `der Stuhl` → wrong (plural), `"fährt"` for `fahren` → wrong (form), no "Ik had gelijk".

---

## 8. Scheduling and sessions

### 8.1 FSRS
- **FSRS v5 or later** with default parameters; vendor an established implementation and check its license. Desired retention is a setting (default 0.90, range 0.80–0.95).
- **Let the library own all card state and intervals.** `session.js` only decides *when within a session* a card is shown again (§6.2), never what its schedule becomes. **The library's own short-term (learning/relearning) steps are turned off**, because the session handles those steps itself: during Leren, the multiple-choice answers are logged but not rated, and FSRS gets **one** rating when the word graduates (Good; Hard when the word was missed somewhere in its learning steps) or passes Te makkelijk (Easy). FSRS sets a card's difficulty and first interval from its first rating (Good: 3 days, difficulty 2.1; Hard: 2 days, difficulty 5.1), and Anki feeds it every learning-step answer, so a struggle shows; always rating Good threw that away and made hard words start out looking easy. Simulated cost (10 seeds, 90 days): 32 → 36 reviews and 14.8 → 15.7 minutes a day (17.5 → 19.1 in the last four weeks). The simulated learner recalls at FSRS's own prediction, so it can't show the benefit; the owner's first-review pass rate per first rating will (§14). A lapse is rated Again once, when it happens; the relearning typing step afterwards is session-only and not rated. The few extra rules (siblings, confusable sets, the overdue pause) each live in one named, tested function.
- Grades: Again, Hard (only from Almost), Good, Easy (only from the secondary action and Te makkelijk).
- **Review log** of every answer: card id, timestamp, grade, typed answer, ms.
- **Day boundary at 04:00 local time.**
- **Simulation:** `tools/simulate.js` runs a simulated learner for 90 days (10 new words a day, realistic error rate, some skipped days). At the end of Stage 2, and after any scheduling change, report to the owner in plain language: reviews and minutes per day over time, retention, and anything odd.

### 8.2 Sessions
Progress is saved after every answer, so stopping at any time loses nothing.
- **Herhalen:** relearning steps and due reviews (production → recognition → advanced cards; lowest retrievability first). Card types are interleaved. Done: **"Klaar met herhalen"** (cards done, time spent). **Leren:** rounds (§6.2); done: **"Klaar voor vandaag"** (cards, time, new words; later a button to copy today's words). **Toets:** §6.4. Home makes **Herhalen** the primary button while reviews are due, otherwise Leren. (Until v0.8.0 one Start button mixed one new word in after every 4 reviews.)
- **Eindeloos** (Stage 4): after today's work, keep practising Shaky words and reviewing ahead. **Practice only, doesn't change schedules**, but misses make a word Shaky. Also a **"+5 nieuwe woorden"** button.
- An exit button ends any session cleanly.
- Home shows due cards and an estimate in minutes (median seconds per card type from the review log; defaults until there's data: production 12 s, recognition 6 s, cloze 15 s, plural 8 s, verbforms 20 s, new word 60 s). The quick scan is separate and not in the estimate.
- **Reviews first:** if more than ~30 minutes of reviews are overdue, new words pause, with a one-line explanation on Home.

---

## 9. Screens

Bottom tab bar, monochrome, three tabs: **Leren** · **Woorden** · **Instellingen**. All text in `strings.nl.js`.

- **Leren (Home):** a **Herhalen** block (due count + minutes, relearning words, button) and a **Leren** block: the level (chosen, or "automatisch") with **Ander niveau** (the level list: Automatisch, then every level with its progress bar), a progress bar in three parts (gekend solid, bezig grey, nieuw empty) with "*a* gekend · *b* bezig · *c* nieuw", "Vandaag nog *n* nieuwe woorden", unfinished words, buttons **Leren** and **Toets**, "Te makkelijk?" or the "Dit niveau lijkt te makkelijk" offer (§6.1); the quick scan ("Snel doorlopen: *n* woorden vandaag", if any); **Eindeloos** from Stage 4; a quiet stats line (words learned · reviews today · 30-day retention; no streaks); new words left in the data; backup reminder when the last backup is > 7 days old (dismissible for a day); "Update beschikbaar" when a new version is waiting. On first run: a short screen saying to add the app to the home screen first and only use it from there, and that deleting the icon deletes all progress.
- **Session:** the card flow, a thin count-based progress bar (per round on Leren), "Ronde *n*" or "Toets · *i* van *n*", an exit button, an audio on/off toggle.
- **Woorden** (Stage 3): **Kopieer woorden** at the top (§11.1); tabs **Recent** (introduced in the last 14 days) · **Gevestigd** (established) · **Wankel** (lapse in the last 14 days, ≥ 3 lapses, or missed in Endless; leeches badged); search across all words. **Word detail:** lockup, example, cards with state and next due date, and the actions suspend / reset / mark known / leer dit als volgende / meld fout. **Meldingen** section (§11.2).
- **Instellingen:** daily new-word limit (with "≈ 20–30 min per dag na een paar maanden" next to it, from the simulation) · desired retention · recognition cards on/off · ignore capitalisation · umlaut shortcuts · example sentence always shown (default off) · **Niveaus**: "Ik begin bij" A1 / A2 / B1, and every level with a "te makkelijk" checkbox · audio voice, speed, auto-play · backup / restore · reset everything (double confirmation) · app version.

---

## 10. UI spec

### 10.1 Visual base
- Background light `#F7F6F2`, dark `#141619`; off-white text in dark mode. Follows the system setting.
- Font: **Atkinson Hyperlegible**, self-hosted woff2 (OFL). Verify ä ö ü ß render. Fallback: Inter, system-ui.
- The main word sits at the **same fixed position** on every card.
- Primary buttons at the bottom, in thumb reach. Respect safe areas (`viewport-fit=cover`, `env(safe-area-inset-*)`).
- Motion: a short fade at most; respect `prefers-reduced-motion`.
- Short messages at the bottom (toasts, such as "Goed ✓" after a multiple choice) let taps through to the buttons under them and disappear as soon as the next answer is revealed, so they never contradict its feedback (until v0.7.0 they swallowed a tap on "Verder" for 1.2 s and could sit over "Niet goed").

### 10.2 Gender colors (after answering only)
- **der = blue · die = orange-red · das = teal-green**, starting from Okabe-Ito (`#0072B2`, `#D55E00`, `#009E73`). Adjust for ≥ 4.5:1 contrast on both backgrounds, with lighter variants in dark mode.
- Paired with shapes: der ■ · die ● · das ▲. The article text is always shown; color and icon only support it.
- On reveal, the article and a thin card border take the gender color.
- **de/het note** when Dutch het ↔ German not das, or Dutch de ↔ German das ("NL: het meisje → DE: das Mädchen", "NL: de zon → DE: die Sonne"). Shown when the word is shown after a wrong choice and on every reveal of that noun.

### 10.3 Card layout
1. **Context sentence** (18px, muted): Dutch sentence with the prompt word bold on production; German sentence with the target bold on recognition; German with a blank and the Dutch below on cloze. **Hidden by default** (owner request): a small "Toon zin" button sits in its fixed-height space, so the word doesn't move, and tapping it keeps the keyboard up. Once shown, it stays shown for that card's answer side (German sentence, plus the Dutch one under the lockup). The word shown after a wrong choice always shows it; the setting "Voorbeeldzin altijd tonen" shows it everywhere. Words of a context set (§4.2) and cloze cards (Stage 4) need their sentence and always show it.
2. **Word** (32px, bold) at the fixed position, with its `nlHint` small and muted underneath on the prompt side.
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
- **Never on the prompt side.** Plays automatically after each answer (default on), including a multiple choice; the info bar has a replay button.

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
- `cards`: `{ id: "214:production", wordId, type, fsrs, suspended: bool, step, leech }`. `step` is the session step the card is at (`intro` = new, first question not answered yet; `mc`; `type1` = typed; `tooEasy`; `relearn`; `type2` from before v0.8.0 counts as `type1`) or null once it is in review; `missed: true` while a card in learning has had a miss (removed at graduation, §6.2); a new card's `fsrs.last_review` is stored as null instead of the library's undefined, which a JSON backup would drop. `fsrs` is the FSRS library's card object, stored whole and unchanged (state new/learning/review/relearning, stability, difficulty, due, last review, reps, lapses and any other fields the library keeps), so it always round-trips through the library. `suspended` is a separate flag: suspending never touches `fsrs`, so unsuspending restores the card exactly as it was.
- `reviewLog`: `{ cardId, ts, grade, answer, ms, practice: bool, step, outcome }`. `step` is `intro` (a new word's first question)/`mc`/`type1`/`tooEasy`/`review`/`relearn`/`test`; `grade` is null for steps that aren't rated (§8.1); `outcome` is the grading outcome (§7.2), `correct`/`wrong`/`dontKnow` on a multiple choice, `tooEasy` for Ken ik al, or `override` after "Ik had gelijk"; `reason` on typed answers is `article`, `umlaut`, `plural`, `form` or null, so the stats can show whether articles are the main cause of lapses (§2).
- `words`: `{ wordId, introducedOn, tooEasy, knownMarked, queuedNext, accepted: [], levelCheck?, scannedOn?, scanMissed? }` (`accepted` holds answers allowed through "Ik had gelijk"; `scannedOn` is when a word from a level marked too easy went through the quick scan; known there → `introducedOn`, `levelCheck: true`, `tooEasy: true`; not known → `scanMissed: true`, `queuedNext: true` and no `introducedOn` until it is learned. Test data from before v0.6.0 may still have `checkMissed` from the typed checks; it is ignored)
- `reports`: `{ wordId, ts, kind: "override|report", answer, note }`
- `settings` (incl. `easyLevels: []`, `learnLevel: null` and `showSentence: false`), `meta` (`schemaVersion`, `lastBackup`, `appVersion`, copy-list choice)
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
- **Never reload mid-session.** A new version shows "Update beschikbaar" on Home; it applies on tap, or at the next cold start. The session screen hides the tabs and `app.js` never re-renders Home while a session runs.

### 12.5 iOS notes
- The home-screen app has **separate storage** from Safari tabs, and deleting the icon deletes all progress. The README and first-run screen say both.
- Manifest: `display: standalone`, name "Deutsch", colors from §10.1, icons including a 180px `apple-touch-icon`.

---

## 13. Build stages

One stage per session. Start each stage by planning it against this section, then build, verify and report. Tick items as they're done. A stage is done only when every "Done when" check passes and the evidence is in the report.

### Stage 1 — Foundation
- [x] Repo bootstrap: this file as `PLAN.md`, `CLAUDE.md`, README (one paragraph + iPhone install steps), `.gitignore` (incl. `tools/sources/`, `node_modules/`)
- [x] `package.json` with the commands from §3; Playwright as a dev dependency
- [x] PWA shell, manifest, icons, self-hosted font, service worker with the update flow
- [x] IndexedDB layer with migrations, snapshots, backup export/import
- [x] Three-tab navigation (placeholder screens are fine), Settings basics, first-run install screen
- [x] `tools/rank.js`, `tools/validate.js`, `tools/crosscheck.js`, `tools/SOURCES.md`
- [x] **Words 1–500**, validated, crosschecked and reviewed (§4.3)

*Done when:* `npm run check` passes · e2e shows the app working offline at `/deutsch/` · an e2e test changes the version and confirms the update applies without losing stored data · a backup → reset → restore round trip restores identical data (test) · crosscheck report has no unresolved disagreements · the owner has installed it on his iPhone.

### Stage 2 — Daily learning
- [x] `grading.js` with all tests from §7.6
- [x] FSRS (vendored), production card, review log, day boundary
- [x] New-word flow: intro → multiple choice → two typing steps; Te makkelijk; confusable-set rule
- [x] Lapses and relearning; siblings rule; overdue pause
- [x] Start session with new words mixed in; "Klaar voor vandaag" (copy button can come in Stage 3)
- [x] "Ik had gelijk" with its safeguards (local `accepted` list)
- [x] Key row, audio after answering, gender colors, lockups, de/het and false-friend notes
- [x] Home: due count, minutes, new words left
- [x] `tools/simulate.js` and the 90-day report
- [x] Owner feedback (v0.3.0): real CEFR levels (Goethe lists), learning order with everyday words first (`tools/order.js`), 138 new words (everyday core, 18 phrases), `nlHint` for shared prompts, hard-word cap, word families (`base`)
- [x] Owner feedback (v0.2.1): levels of 100 words with "te makkelijk" per level, as quick checks (§6.1); example sentence behind "Toon zin" (§10.3); `simulate.js --easy N`
- [x] v0.8.1 review fixes: base words come with a chosen level (204 words wait on a base in another level; 8 got stuck); Home's new-word count uses every rule; a chosen level marked too easy falls back to the normal order; a Ken ik al check needs 3 other cards (else the next session) and one from an earlier day doesn't raise today's limit; lapsed words stay gekend in the bar.
- [x] Owner feedback (v0.8.0): Quizlet-style Herhalen / Leren in rounds / Toets, level choice (`learnLevel`) and level progress on Home and in the level list; a new word is stored at its first answer. Simulation, 10 seeds × 90 days: 15.7 → 11.8 minutes a day (19.1 → 14.9 in the last four weeks), 36 → 34 reviews a day, retention 84–85% both.
- [x] Learning review (v0.7.0): Te makkelijk check after `GAP.tooEasy` cards (§6.2); Hard at graduation after a learning miss (`missed`, §8.1); end punctuation, capital article, `variants` (43 entries moved from `acceptAlso`, determiners and possessives added), plural/form feedback (§7); parting-letter hint (§7.2); `reason` in the review log (§12.1); toasts (§10.1); word fixes (wenn/wann, bitten, 6 missing alternatives). Simulation, 10 seeds × 90 days: 32 → 36 reviews and 14.8 → 15.7 minutes a day, retention unchanged.
- [x] Owner feedback (v0.6.0): context sets (`contextSet` + `rule`, 11 sets incl. naar → zu / nach) with the sentence as prompt, sibling options in multiple choice, sibling = Wrong with the rule; 5 phrases for "naar" (*nach Hause, zum Arzt gehen, zur Schule gehen, ins Kino gehen, ans Meer fahren*); levels: "Ik begin bij", the quick scan replaces typed checks (30 a day), "Dit niveau lijkt te makkelijk" after 5 known words; `simulate.js --easy N` models the scan

*Done when:* `npm run check` passes · an e2e test introduces a new word, completes its learning steps and sees it graduate · the backup → reset → restore test is rerun with real FSRS cards and review-log entries, and confirms dates come back as dates and the same cards are due before and after · the simulation report has been shared with the owner and looks sensible · the owner has tried a full session on his phone.

### Stage 3 — Words tab, copy list, recognition
- [ ] Recognition cards for non-cognates, with the daily cap when switched back on in Settings (§5)
- [ ] Woorden tab: Kopieer woorden, Recent / Gevestigd / Wankel, search, word detail with its actions
- [ ] Meld fout + Meldingen list + Kopieer meldingen
- [ ] Leeches; Home stats line; backup reminder
- [x] **Words 501–1,000** with the checks from §4.3 (v0.3.0: 138 words, v0.4.0: 362 more; 650 of the first 1,000 are A1. The ~30 Goethe A1 words still missing, e.g. *Briefmarke, Straßenbahn, Auskunft*, go into the next band; `node tools/order.js` lists them)

*Done when:* `npm run check` passes (incl. copy-list format tests) · e2e: copy a word list, report a word, copy the reports · a test with a few hundred already-learned words and recognition cards switched back on shows new recognition cards stay within the daily cap · the simulation, rerun with recognition cards, still looks sensible.

### Stage 4 — Advanced cards and Endless
- [ ] Cloze, plural and verbforms cards with the 21-day unlock and the daily cap (§5); `clozeOnly` words via cloze
- [ ] Eindeloos with practice and "+5 nieuwe woorden"
- [ ] **Words 1,001–2,000** in bands of 500, each with the checks from §4.3 (1,001–1,500 done in v0.5.0, incl. 15 `clozeOnly` grammar words waiting for cloze cards; v0.6.0 added 5 phrases, so `words-1501-2000.json` already holds 5 words; 1,501–2,000 next: the ~100 Goethe A2 words `node tools/order.js` still lists, then frequent B1 words)

*Done when:* `npm run check` passes · the simulation still looks sensible with the new card types, including days when many words cross the 21-day unlock at once.

### Launch — the owner starts learning for real
- [ ] Backup and restore work from Instellingen on the iPhone: a backup saved to iCloud Drive restores correctly
- [ ] Tell the owner to use "reset everything" in Instellingen so he starts without test progress
- [ ] Set the Status line to "Launched". From here on the migration rule (§12.3) and the backup reminder before data-changing updates apply in full.

*Done when:* the owner has reset his test data, made his first backup, and started his first real session.

---

## 14. Out of scope and later ideas

**Out of scope:** accounts, syncing between devices, any AI or network feature in the app, gamification (streaks, points, badges), Android-specific work, a build step.

**Parked until there is real learning data** (from the v0.7.0 review; each says what would settle it):
- *Almost → Hard on reviews.* One Hard slows a word's intervals a lot (3, 9, 30 days instead of 3, 14, 57). If words answered Almost pass their next review as often as words answered Good, map Almost to Good (keep the highlight and retype).
- *One typed step in Leren, or two* (v0.8.0 went from two to one, like Quizlet; Rawson & Dunlosky 2011 found extra first-session recalls add little once reviews follow, Pyc & Rawson 2009 that more spaced retrievals help). Settle with the first-review pass rate of words learned in rounds: if it is clearly below FSRS's ~0.88, add a second typed round.
- *Quick scan → Good instead of Easy* (Koriat & Bjork 2005: people overrate what they know when the answer is in view). Measured: 3 levels scanned, 10 seeds, it costs 5 more reviews a day and the heaviest day goes from 43 to 53 minutes, for catching a not-really-known word at day 3 instead of 8. Settle with the first-review pass rate of scanned words (if well below ~0.9, switch).
- *Check the first ratings.* After about 4 weeks: first-review pass rate per way a word entered review (Good, Hard, Te makkelijk, scan) against FSRS's ~0.88–0.90; then FSRS parameter optimisation (below).
- *A gender drill* (§2): the log now records `reason: "article"`; reopen if articles cause most lapses.

**Later, only if the owner asks or real use shows a need:** words 2,001–5,000 (and whether low-frequency words should be recognition-first) · a placement test · the owner's own words (separate id range) · FSRS parameter optimisation from the review log · a separate gender drill · Präteritum for all strong verbs · compound-word dividers · a statistics page with a review forecast · a forecast on "+5 nieuwe woorden".
