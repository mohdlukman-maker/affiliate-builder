# NEXT TASK — Affiliate Builder UI

> The single most appropriate next task. No active development — this
> is a maintenance-era project; tasks below are candidates when the
> user next works on it.

## Objective

**Default: no code change needed.** First worthwhile task when the
user returns: **harden the Shopee scraper against markup drift** (or
swap to a stable API/adapter pattern).

## Why it is needed

Search/scrape depends on current Shopee MY markup with no drift
detection — when Shopee changes their page, search silently degrades
and the failure mode is unclear to the user.

## Relevant files

- `server.js` — search + scrape handlers
- `config.json` — marketplace config (adapter candidates live here)
- `test/smoke.test.cjs` — extend with a fixture-based scrape test

## Requirements (if undertaken)

1. Isolate marketplace-specific parsing into an adapter module.
2. Add a saved fixture (HTML snapshot) + parser test so drift is
   caught locally without network.
3. Keep the 16 existing tests green; add fixture tests alongside.
4. No new runtime dependencies.

## Acceptance criteria

- [ ] `node test/smoke.test.cjs` → all pass incl. new fixture tests
- [ ] Real search still works live (manual check)
- [ ] `git status` clean after commit

## Constraints

- Local-only repo — commits stay local; no remote/push without user
  approval.
- Keep deps minimal.

## Things that must NOT be changed unnecessarily

- The sanitization tests and their behavior.
- `drafts/` ignore rule and storage layout.
- The publish flow contract (token in `.env`).

## Alternative candidates

- GitHub private backup (needs user approval first — repo is
  local-only by decision)
- Additional marketplace adapters (Lazada, TikTok Shop)
