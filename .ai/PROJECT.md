# PROJECT — Affiliate Builder UI

> Stable project reference. Change this file rarely.
> Current state: `STATUS.md`; immediate task: `NEXT_TASK.md`.

## Purpose

Local, self-contained web UI for building **one-page affiliate promo
sites** and publishing them to Netlify. Searches a marketplace
(default: Shopee Malaysia), scrapes product images, generates a clean
landing page, manages named **drafts**, and publishes the chosen one.

## Main objective

Affiliate promo page from product link → landing page → Netlify,
running entirely on the user's machine, configurable for any affiliate
program via `config.json` (marketplace, locale, copy text).

## Major requirements

- Local-first: no account, no database, no cloud service except the
  optional Netlify publish target.
- Marketplace-agnostic config: `config.json` drives marketplace,
  locale, brand, CTA labels.
- URL sanitization is security-critical (test suite locks it):
  reject empty / `javascript:` / `data:` / non-https.
- Drafts: multiple named drafts kept locally (`drafts/` — gitignored).
- Publish to Netlify via `netlify-cli` (token in `.env`, never
  committed; site ID in `.netlify/state.json` — ID only, not secret).
- Node ≥ 18, minimal deps (dotenv; netlify-cli devDependency).

## Technology stack

- Node.js ≥ 18 (Express-style `server.js`, single-file server)
- Vanilla JS frontend (`public/`)
- Netlify CLI for publish
- Test: plain Node smoke script (`test/smoke.test.cjs`, no framework)

## Architecture

    server.js       — HTTP server: /api/search, /api/scrape, /api/draft,
                      /api/render, publish action, static serving
    public/         — index.html, app.js, styles.css, template.css
    config.json     — marketplace/locale/copy config (committed)
    drafts/         — local named drafts (GITIGNORED — user content)
    .netlify/       — netlify.toml + state.json (siteId only)
    netlify-site.example.json — publish-target template
    .env            — NETLIFY_AUTH_TOKEN (GITIGNORED, never commit)

## Important constraints

- **LOCAL-ONLY repo** (per user decision 2026-08-22): git init'd with
  baseline, NO remote. Do not add a remote / push without explicit
  user approval.
- Never commit `.env`, `drafts/`, `netlify-site.local.json`,
  `node_modules/`.
- URL sanitization behavior must stay locked by tests — any change to
  `renderSite`/URL validation must keep the 7 sanitization tests green.
- Keep dependency footprint minimal (dotenv + netlify-cli only).

## Supported platforms

- Windows (user's machine), any OS with Node ≥ 18.

## Key external dependencies

- Optional: Shopee MY (search/scrape — may break if markup changes)
- Optional: Netlify (publish; token required)

## Repository

- **LOCAL ONLY** — `C:\Users\mohdl\affiliate-builder`, branch `main`,
  baseline `92633a6`. No remote configured (deliberate).
