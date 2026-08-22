# AGENTS.md — Affiliate Builder UI

This file defines how AI agents (Hermes, Claude, Codex, …) work on this
repository. **Read it before touching anything.**

## Project in one paragraph

Local Node web UI (single `server.js` + vanilla frontend) that builds
one-page affiliate promo sites: marketplace search (default Shopee MY)
→ image scrape → landing-page render → named drafts → optional
Netlify publish. Config-driven (`config.json`), minimal deps, URL
sanitization is security-critical. **Local-only repo — no remote.**

## Before Starting Work

Always, in order:

1. Read `AGENTS.md` (this file).
2. Read `.ai/PROJECT.md`.
3. Read `.ai/STATUS.md`.
4. Read `.ai/NEXT_TASK.md`.
5. Read `.ai/DECISIONS.md`.
6. Inspect `git status`; `git log --oneline -10`.
7. Inspect the actual code before making assumptions.

**Never assume that the previous AI session was correct.**

## Environment

    npm install            # once
    node test/smoke.test.cjs   # canonical verification (16 tests)

⚠️ Use `node test/smoke.test.cjs`, NOT `npm test` — the npm wrapper
prints a libuv assertion warning from netlify-cli teardown on this
machine (cosmetic, but noisy).

Run the app: `npm start` (server on :8787; the live-server smoke test
then runs too).

## During Development

- Smallest reasonable change; keep the 16 smoke tests green.
- Never weaken URL sanitization (javascript:/data:/http rejection,
  https enforcement) — it's the security boundary of rendered pages.
- Never commit `.env`, `drafts/`, `netlify-site.local.json`,
  `node_modules/`.
- Keep dependencies minimal (dotenv runtime; netlify-cli dev-only).
- Marketplace-specific parsing changes need a live manual check of
  search before ending work.

## Before Ending Work

1. Run `node test/smoke.test.cjs` — all green.
2. Update `.ai/STATUS.md` (verified facts only).
3. Update `.ai/NEXT_TASK.md`.
4. Update `.ai/SESSION_LOG.md`.
5. Record decisions in `.ai/DECISIONS.md`.
6. Review `git status` / `git diff` — no secrets, no drafts staged.
7. Commit (conventional style). **No push — local-only repo.**
8. Working tree clean.

## Commit message style

    feat: marketplace adapter for lazy parsing
    fix: reject mixed-case javascript: scheme
    test: fixture test for shopee parser

## Hard rules

- **No remote, no push** without explicit user approval (local-only
  decision 2026-08-22).
- Destructive ops (`rm -rf`, `git reset --hard`, force anything) need
  explicit human authorization.
- The Netlify token in `.env` is real — never print or commit it.
