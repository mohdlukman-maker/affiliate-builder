# DECISIONS — Affiliate Builder UI

> Important architectural/technical decisions only. Append at the end;
> never rewrite history.

## 2026-08-22 — Version control initialized local-only (no remote)

Decision:
`git init` + baseline commit; **no GitHub remote**.

Reason:
User directive "local only" for this batch of projects. The project
had zero version control; baseline first, remote later only with
explicit approval.

Rejected:
- Creating a private GitHub repo immediately — user said local only.
- Waiting to init git until a remote decision — baseline protection
  of 16 working files should not wait.

## 2026-08-22 — Baseline includes .netlify/state.json (siteId, not secret)

Decision:
Commit `.netlify/state.json` as-is; it holds only a Netlify siteId.

Reason:
Reviewed the file contents directly: `{"siteId": "<uuid>"}`. A site
ID is not a credential (cannot authenticate anything alone); the auth
token lives in `.env` (gitignored). Keeping state.json versioned makes
the publish target reproducible.

Rejected:
- Gitignoring `.netlify/` wholesale — would also hide netlify.toml
  config and lose the site binding.

## 2026-08-22 — Verify with direct node invocation, not npm test

Decision:
Use `node test/smoke.test.cjs` as the canonical verification command;
document the `npm test` libuv-warning quirk instead of "fixing" it.

Reason:
The warning comes from netlify-cli teardown inside npm's process
management on this Windows machine — not from the project's code.
Chasing it would add churn with no behavioral gain.

Rejected:
- Upgrading/replacing netlify-cli to silence a cosmetic warning.
