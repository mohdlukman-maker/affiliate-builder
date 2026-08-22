# SESSION LOG — Affiliate Builder UI

> One entry per meaningful development session, newest at the top.

---

## 2026-08-22 — Version-control bootstrap (local-only)

- **Objective:** Give the project its first-ever version control
  (persistence-workflow migration, local-only batch, project 1/5).
- **Work completed:**
  - Verified real state first: `node test/smoke.test.cjs` → 16/16 pass.
  - Reviewed staged file list + secret scan before committing
    (`.env`/`drafts/`/`*.local.json` all correctly excluded;
    `.netlify/state.json` verified siteId-only).
  - `git init -b main`; baseline `92633a6` (16 files).
  - Created `.ai/` state system + `AGENTS.md`.
- **Problems discovered:** `npm test` wrapper emits libuv assertion
  noise (netlify-cli teardown, Windows) — cosmetic; direct node
  invocation is clean. Documented, not fixed.
- **Decisions made:** See `DECISIONS.md` 2026-08-22 (local-only init;
  state.json committed after content review; canonical verify command).
- **Tests performed:** smoke suite 16/16; staged-diff secret scan.
- **Remaining work:** none urgent. Candidates in `NEXT_TASK.md`
  (scraper hardening first; GitHub backup only with user approval).
- **Next recommended task:** scraper adapter + fixture tests (if user
  resumes development).
- **Commit:** `92633a6` baseline + this docs commit (see git log).
