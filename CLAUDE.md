# Deutsch: German vocabulary PWA

Read PLAN.md before doing anything. It is the spec, and its Status line and stage checklists (§13) show where the work stands. Update both when you finish something.

## Commands
- `npm run serve`: app at http://localhost:8080/deutsch/ (same subpath as GitHub Pages)
- `npm test`: unit tests (`node --test`) + data validator
- `npm run e2e`: Playwright run at iPhone size, incl. offline reload
- `npm run check`: all of the above + the version-bump check. IMPORTANT: must pass before every push.
- `node tools/simulate.js`: 90-day simulated learner (reviews, minutes, retention per week). Rerun after any scheduling change and report it (PLAN §8.1).

## Rules that are easy to get wrong
- IMPORTANT: bump the version constant in `sw.js` on every push that changes any file the service worker caches. That includes the word files in `words/`, not just code. Without the bump the owner's phone keeps the old copy forever. `npm run check` fails if you forget.
- The app is plain HTML/CSS/JS ES modules with no build step. Dev tooling stays out of the files the app loads.
- All app paths are relative (`./`); the app lives under `/deutsch/`.
- After launch (PLAN §13), any change to stored data needs a tested migration in `db.js`. Never risk the owner's progress. Before launch his data is test data and may be reset instead (PLAN §12.3).
- Never commit secrets or raw third-party word lists (`tools/sources/` is gitignored).
- Push straight to `main`; GitHub Pages deploys from it.

## The owner
He doesn't read code and tests on his iPhone. He tests each stage but only starts learning for real once all stages are done. Explain in plain language. End each stage with what changed, what you decided for him, and 5–10 things to try on the phone.
