# Affiliate Builder UI

A **local, self-contained** web UI for building one-page affiliate promo sites
and publishing them to Netlify. It searches a marketplace (default: Shopee
Malaysia), scrapes product images, generates a clean landing page, lets you
preview multiple named **drafts**, and publishes the one you pick.

Everything runs on your machine. No account, database, or cloud service is
required except an optional Netlify site for publishing. The marketplace,
locale, and copy text are all driven by `config.json`, so the tool works for
any affiliate program — not just Shopee.

## Features

- **Configurable marketplace** — edit `config.json` to target any site
  (search host, country, affiliate domains, image CDNs, CTA labels, copy).
- **Resilient search** — DuckDuckGo with a Bing fallback; fails loudly instead
  of publishing an empty page (#3).
- **Affiliate-URL hardening** — only `https:` links are embedded;
  `javascript:`/`data:`/`http:` are rejected (#4).
- **Named drafts** — every generate is saved under `drafts/<slug>/` with a
  `manifest.json`; nothing is overwritten (#6).
- **Split CSS** — design lives in `public/template.css`, copied into each draft (#7).
- **Pluggable trend source** — add more search engines by extending `trendSources` (#8).
- **Smoke tests** — `npm test` (14 checks).

## Quick start

```bash
git clone <your-repo-url> affiliate-builder-ui
cd affiliate-builder-ui
npm install
cp .env.example .env          # paste NETLIFY_AUTH_TOKEN if you publish
cp netlify-site.example.json netlify-site.local.json   # paste your site_id
npm start
```

Open <http://localhost:8787>.

To publish you also need a Netlify site + token (see below). Skipping those
still lets you **search, generate, and preview** drafts locally.

## Configuration

### `config.json` (committed, safe to share)

```jsonc
{
  "marketplace": {
    "name": "Shopee",
    "searchHost": "shopee.com.my",
    "country": "Malaysia",
    "domains": ["shopee.com.my", "shopee.com", "shopee.sg", "shopee.co.id"],
    "imageHosts": ["susercontent.com", "shopee", "cloudfront.net"],
    "ctaLabel": "Lihat di Shopee",
    "openLabel": "Buka Shopee"
  },
  "locale": { "lang": "ms", "acceptLanguage": "ms-MY,ms;q=0.9,en;q=0.8" },
  "copy": { ... }
}
```

To retarget (e.g. Lazada Indonesia), change `marketplace` + `copy` — no code edits.

### `netlify-site.local.json` (git-ignored, secret)

```json
{ "site_id": "<your-netlify-site-id>", "site_name": "", "site_url": "" }
```

Get the `site_id` from your Netlify site settings, or `npx --yes netlify-cli
sites:list`.

### `.env` (git-ignored, secret)

```
NETLIFY_AUTH_TOKEN=your-token
# PORT=8787   # optional
```

Create the token with `npx --yes netlify-cli login`.

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/api/status`    | site config, draft list, token presence |
| GET  | `/api/drafts`    | full draft manifest |
| GET  | `/api/search?category=&period=&source=` | search the marketplace (`duckduckgo`/`bing`) |
| POST | `/api/generate`  | body `{title, category, productUrl, affiliateUrl}` → saves a draft |
| POST | `/api/publish`   | body `{slug?}` → deploys that draft (latest by default) |
| DELETE | `/api/draft/<slug>` | removes a draft folder + manifest entry |
| GET  | `/preview/<slug>/` | serves a generated draft for review |

## Project layout

```
affiliate-builder-ui/
├── server.js                 # Node HTTP server
├── config.json               # marketplace + copy (edit me)
├── public/                   # UI (index.html, app.js) + template.css
├── drafts/                   # generated drafts (git-ignored)
├── test/smoke.test.cjs       # npm test
├── netlify-site.example.json # template → netlify-site.local.json
├── netlify-site.local.json   # your site_id (git-ignored)
├── .env.example              # NETLIFY_AUTH_TOKEN, PORT
├── package.json
├── LICENSE                   # MIT
└── README.md
```

## Development

```bash
npm test          # 14 smoke checks
npm start         # serve on :8787
```

Node 18+ required.

## License

MIT — see [LICENSE](LICENSE).
