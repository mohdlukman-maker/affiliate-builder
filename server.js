// Affiliate Builder UI — server
// Self-contained: no dependency on any external workspace.
// Upgraded: pinned deps, smoke tests, affiliate-URL hardening, resilient
// image search (DuckDuckGo + Bing fallback), dotenv, named drafts, split CSS,
// and a pluggable "trend source" layer.

require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const root = __dirname;
const publicDir = path.join(root, "public");
const draftsDir = path.join(root, "drafts");
const templateCssPath = path.join(publicDir, "template.css");
const siteConfigPath = path.join(root, "netlify-site.local.json");
const appConfigPath = path.join(root, "config.json");

// Load marketplace/locale/copy config; never fails the server if absent.
function loadAppConfig() {
  const defaults = {
    marketplace: { name: "Shopee", searchHost: "shopee.com.my", country: "Malaysia", domains: ["shopee.com.my"], imageHosts: ["susercontent.com", "shopee"], ctaLabel: "View on Shopee", openLabel: "Open Shopee" },
    locale: { lang: "ms", acceptLanguage: "ms-MY,ms;q=0.9,en;q=0.8" },
    copy: { brand: "Affiliate Pick", defaultTitle: "Featured Product", defaultCategory: "Product", disclosure: "Affiliate disclosure: this page may earn a small commission from purchases made through the link, at no extra cost to you." },
  };
  if (!fs.existsSync(appConfigPath)) return defaults;
  try {
    const user = JSON.parse(fs.readFileSync(appConfigPath, "utf8"));
    return {
      marketplace: { ...defaults.marketplace, ...(user.marketplace || {}) },
      locale: { ...defaults.locale, ...(user.locale || {}) },
      copy: { ...defaults.copy, ...(user.copy || {}) },
    };
  } catch {
    return defaults;
  }
}

const CONFIG = loadAppConfig();
const MARKET = CONFIG.marketplace;
const MARKET_DOMAIN_RE = new RegExp(
  `(^|\\.)(${MARKET.domains.map((d) => d.replace(/\./g, "\\.")).join("|")})$`,
);
const MARKET_IMAGE_RE = new RegExp(
  MARKET.imageHosts.map((h) => h.replace(/\./g, "\\.")).join("|"),
  "i",
);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

// In-memory pointer to the most recently generated draft (for /preview/).
let latestDraftSlug = null;

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(type.includes("json") ? JSON.stringify(body, null, 2) : body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function safeText(value, fallback = "") {
  return String(value || fallback)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeFileName(value) {
  return (
    String(value || "product")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "product"
  );
}

// #4 — Affiliate URL hardening.
// Only https: links are accepted (blocks javascript:, data:, etc.). The host
// should be a known marketplace property; other https hosts are allowed but flagged.
function validateAffiliateUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return { ok: true, url: "", warning: "" };
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, url: "", warning: `Not a valid URL: "${raw}"` };
  }
  if (parsed.protocol !== "https:") {
    return {
      ok: false,
      url: "",
      warning: `Affiliate link must use https:// (got ${parsed.protocol}). Refusing to embed.`,
    };
  }
  const isMarket = MARKET_DOMAIN_RE.test(parsed.hostname);
  return {
    ok: true,
    url: raw,
    warning: isMarket
      ? ""
      : `Warning: URL host "${parsed.hostname}" is not a ${MARKET.name} domain.`,
  };
}

function decodeDuckUrl(url) {
  try {
    if (!url.includes("duckduckgo.com/l/")) return url;
    const parsed = new URL(url.startsWith("//") ? `https:${url}` : url);
    return parsed.searchParams.get("uddg") || url;
  } catch {
    return url;
  }
}

async function fetchText(url, headers = {}) {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      "accept-language": CONFIG.locale.acceptLanguage,
      ...headers,
    },
  });
  if (!response.ok)
    throw new Error(`Fetch failed ${response.status}: ${url}`);
  return response.text();
}

// ----------------------------------------------------------------------------
// #8 — Pluggable trend source layer
// Each source returns { query, results: [{ title, url, snippet }] }.
// ----------------------------------------------------------------------------

const periodWords = {
  day: "today yesterday",
  week: "this week 7 days",
  month: "this month 30 days",
};

function buildMarketQuery(category, period) {
  const words = periodWords[period] || "this week";
  return `site:${MARKET.searchHost} ${category} viral ${MARKET.country} ${MARKET.name} ${words}`;
}

async function searchDuckDuckGo(category, period) {
  const query = buildMarketQuery(category, period);
  // DDG Lite is far less likely to be blocked than /html/ and returns clean
  // result-link anchors whose real URLs live in a uddg= param.
  const html = await fetchText(
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
  );
  const results = [];
  const anchorRegex =
    /<a\s+[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/g;
  for (const match of html.matchAll(anchorRegex)) {
    const tag = match[0];
    const uddg = tag.match(/uddg=([^&"']+)/);
    const rawUrl = uddg ? decodeURIComponent(uddg[1]) : "";
    if (!rawUrl || !rawUrl.includes(MARKET.searchHost)) continue;
    const m = rawUrl.match(/[?&]q=([^&]+)/);
    const url = m ? decodeURIComponent(m[1]) : rawUrl;
    const title = match[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
    results.push({ title, url, snippet: "" });
    if (results.length >= 12) break;
  }
  return { query, results };
}

async function searchBing(category, period) {
  const query = buildMarketQuery(category, period);
  const html = await fetchText(
    `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
  );
  const results = [];
  const itemRegex =
    /<li class="b_algo"[\s\S]*?<h2><a href="([^"]+)"[\s\S]*?>([\s\S]*?)<\/a>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/g;
  for (const match of html.matchAll(itemRegex)) {
    const url = match[1];
    if (!url.includes(MARKET.searchHost)) continue;
    const title = match[2].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
    const snippet = match[3]
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .trim();
    results.push({ title, url, snippet });
    if (results.length >= 12) break;
  }
  return { query, results };
}

const trendSources = {
  duckduckgo: searchDuckDuckGo,
  bing: searchBing,
};

// #3 — Resilient web search: primary source, fallback, and "fail loudly".
async function searchWeb(category, period, source) {
  const primary = trendSources[source] ? source : "duckduckgo";
  const fallback = primary === "duckduckgo" ? "bing" : "duckduckgo";
  let result = { query: "", results: [] };
  let lastError = null;
  for (const name of [primary, fallback]) {
    try {
      result = await trendSources[name](category, period);
      if (result.results.length) return result;
      lastError = new Error(`${name} returned 0 results`);
    } catch (error) {
      lastError = error;
    }
  }
  // Both sources failed — return empty but with the query so the UI can show it.
  if (!result.query) result = { query: "", results: [] };
  result.error = lastError ? lastError.message : "No results from any source.";
  return result;
}

// ----------------------------------------------------------------------------
// #3 — Resilient image search (DuckDuckGo /i.js, then Bing images fallback)
// ----------------------------------------------------------------------------

async function searchImagesDuckDuckGo(query, productUrl) {
  const imageQuery = `${query} ${productUrl || ""} ${MARKET.name} ${MARKET.country}`;
  const html = await fetchText(
    `https://duckduckgo.com/?q=${encodeURIComponent(imageQuery)}&iax=images&ia=images`,
  );
  const vqd = (html.match(/vqd=["']([^"']+)/) || [])[1];
  if (!vqd) return [];
  const imageJson = await fetchText(
    `https://duckduckgo.com/i.js?l=my-en&o=json&q=${encodeURIComponent(
      imageQuery,
    )}&vqd=${encodeURIComponent(vqd)}&f=,,,&p=1`,
    { referer: "https://duckduckgo.com/" },
  );
  const parsed = JSON.parse(imageJson);
  return (parsed.results || [])
    .filter((item) => item.image && MARKET_IMAGE_RE.test(item.image))
    .slice(0, 6)
    .map((item) => ({
      title: item.title,
      image: item.image,
      listing: item.url,
      width: item.width,
      height: item.height,
    }));
}

async function searchImagesBing(query, productUrl) {
  const imageQuery = `${query} ${productUrl || ""} ${MARKET.name} ${MARKET.country}`;
  const html = await fetchText(
    `https://www.bing.com/images/search?q=${encodeURIComponent(imageQuery)}`,
  );
  const results = [];
  // Bing embeds the full-size media URLs in a JS blob as murl:"https://...".
  const murlRegex = /murl&quot;:&quot;(https?:[^&"]+)/g;
  for (const match of html.matchAll(murlRegex)) {
    const image = match[1].replace(/&amp;/g, "&");
    if (!/^https?:/.test(image)) continue;
    if (!MARKET_IMAGE_RE.test(image)) continue;
    results.push({
      title: imageQuery,
      image,
      listing: productUrl || "",
      width: null,
      height: null,
    });
    if (results.length >= 6) break;
  }
  return results;
}

async function searchImages(query, productUrl) {
  let images = [];
  let lastError = null;
  for (const fn of [searchImagesDuckDuckGo, searchImagesBing]) {
    try {
      images = await fn(query, productUrl);
      if (images.length) return images;
      lastError = new Error("no images returned");
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) {
    // Surface the problem instead of silently producing an empty site.
    throw new Error(
      `Image search failed from all sources (${lastError.message}). ` +
        `Try a different product title, or paste a direct product link.`,
    );
  }
  return images;
}

async function downloadImages(images, productSlug, draftDir) {
  const assetDir = path.join(draftDir, "assets", "product");
  fs.mkdirSync(assetDir, { recursive: true });
  const saved = [];
  let index = 1;
  for (const image of images.slice(0, 4)) {
    try {
      const response = await fetch(image.image, {
        headers: {
          "user-agent": "Mozilla/5.0",
          referer: `https://${MARKET.searchHost}/`,
        },
      });
      if (!response.ok) continue;
      const contentType = response.headers.get("content-type") || "";
      const ext = contentType.includes("png") ? "png" : "jpg";
      const file = `${productSlug}-${String(index).padStart(2, "0")}.${ext}`;
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(path.join(assetDir, file), buffer);
      saved.push({ ...image, file: `assets/product/${file}` });
      index += 1;
    } catch {
      // Skip individual image failures.
    }
  }
  fs.writeFileSync(
    path.join(assetDir, "sources.json"),
    JSON.stringify(saved, null, 2),
  );
  return saved;
}

// ----------------------------------------------------------------------------
// Copy generation
// ----------------------------------------------------------------------------

// Copy selection driven by config.json (CONFIG.copy.categories).
// The last entry (match: []) is the default fallback.
function categoryCopy(category) {
  const lower = String(category || "").toLowerCase();
  const categories = CONFIG.copy.categories || [];
  for (const entry of categories) {
    if (entry.match && entry.match.some((m) => lower.includes(m.toLowerCase()))) {
      return entry;
    }
  }
  // Fallback to the entry with no match rules, else the first, else a stub.
  return (
    categories.find((e) => !e.match || e.match.length === 0) ||
    categories[0] || {
      eyebrow: CONFIG.copy.defaultCategory || "Produk",
      headline: "",
      benefits: [],
      faq: "",
    }
  );
}

function renderSite({ title, category, productUrl, affiliateUrl, images }) {
  const copy = categoryCopy(category);
  const ctaHref = affiliateUrl ? safeText(affiliateUrl) : "#";
  const safeTitle = safeText(title || CONFIG.copy.defaultTitle);
  const safeCategory = safeText(category || CONFIG.copy.defaultCategory);
  const safeBrand = safeText(CONFIG.copy.brand);
  const ctaLabel = safeText(MARKET.ctaLabel);
  const openLabel = safeText(MARKET.openLabel);
  const disclosure = safeText(CONFIG.copy.disclosure);
  const marketName = safeText(MARKET.name);
  const slides = images.length
    ? images
        .map(
          (image, index) => `
              <figure class="slide${index === 0 ? " is-active" : ""}">
                <img src="${safeText(image.file)}" alt="${safeTitle}">
              </figure>`,
        )
        .join("")
    : `
              <figure class="slide is-active">
                <div class="placeholder">Gambar produk akan dipaparkan selepas carian imej berjaya.</div>
              </figure>`;
  const dots = images.length
    ? images
        .map(
          (_, index) =>
            `<button type="button" class="${
              index === 0 ? "is-active" : ""
            }" data-dot="${index}" aria-label="Gambar ${index + 1}"></button>`,
        )
        .join("")
    : `<button type="button" class="is-active" data-dot="0" aria-label="Gambar 1"></button>`;

  return `<!doctype html>
<html lang="${safeText(CONFIG.locale.lang)}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${safeTitle}</title>
    <meta name="description" content="${safeTitle} - semak pilihan, harga dan review di ${marketName}.">
    <link rel="stylesheet" href="styles.css">
  </head>
  <body>
    <header class="site-header">
      <a class="brand" href="#top"><span class="brand-mark">AP</span><span>${safeBrand}</span></a>
      <nav><a href="#produk">Produk</a><a href="#komen">Komen</a><a href="#faq">FAQ</a></nav>
    </header>
    <main id="top">
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow">${safeText(copy.eyebrow)}</p>
          <h1>${safeTitle}</h1>
          <p class="lead">Pilihan ${safeCategory} untuk anda semak terus di ${marketName}. Pastikan variasi, harga, penghantaran dan <em>review</em> sesuai sebelum beli.</p>
          <div class="hero-actions">
            <a class="button primary" data-affiliate-link href="${ctaHref}" rel="nofollow sponsored noopener" target="_blank">${ctaLabel}</a>
            <a class="button secondary" href="#produk">Semak dahulu</a>
          </div>
        </div>
        <section class="product-gallery">
          <div class="slider" data-slider>
            <div class="slides">${slides}
            </div>
            <button class="slider-button prev" type="button" data-prev aria-label="Gambar sebelum">‹</button>
            <button class="slider-button next" type="button" data-next aria-label="Gambar seterusnya">›</button>
            <div class="slider-dots">${dots}</div>
          </div>
        </section>
      </section>
      <section id="produk" class="signal-strip">
        ${copy.benefits
          .map(
            (benefit) =>
              `<div><strong>${safeText(
                benefit.split(" ")[0] || "Semak",
              )}</strong><span>${safeText(benefit)}</span></div>`,
          )
          .join("")}
      </section>
      <section class="section two-column">
        <div><p class="eyebrow">Kenapa semak</p><h2>${safeText(copy.headline)}</h2></div>
        <div class="copy-stack">
          <p>Halaman ini dibuat untuk bantu anda lihat produk dengan cepat sebelum pergi ke ${marketName}.</p>
          <p>Tiada tuntutan berlebihan, tiada diskaun palsu, dan tiada testimoni rekaan.</p>
          <a class="text-link" data-affiliate-link href="${ctaHref}" rel="nofollow sponsored noopener" target="_blank">${openLabel}</a>
        </div>
      </section>
      <section id="komen" class="section reviews">
        <div class="section-heading"><p class="eyebrow">Komen pembeli</p><h2>Apa yang patut diperhatikan</h2></div>
        <div class="review-grid">
          <article><div class="stars">★★★★★</div><p>Lihat gambar <em>review</em> untuk bandingkan rupa sebenar.</p></article>
          <article><div class="stars">★★★★★</div><p>Semak komen tentang kualiti, saiz dan penghantaran.</p></article>
          <article><div class="stars">★★★★★</div><p>Pilih variasi yang betul sebelum <em>checkout</em>.</p></article>
        </div>
      </section>
      <section id="faq" class="section faq">
        <div class="section-heading"><p class="eyebrow">Sebelum checkout</p><h2>Semak ringkas</h2></div>
        <details open><summary>Apa perlu saya semak?</summary><p>${safeText(copy.faq)}</p></details>
        <details><summary>Adakah link affiliate sudah dipasang?</summary><p>${
          affiliateUrl
            ? "Ya, butang CTA menggunakan affiliate link yang dimasukkan."
            : "Belum. Butang CTA dikosongkan untuk preview dan boleh diisi kemudian."
        }</p></details>
      </section>
    </main>
    <footer><p>${disclosure}</p></footer>
    <script>
      const AFFILIATE_URL = ${JSON.stringify(affiliateUrl || "")};
      document.querySelectorAll("[data-affiliate-link]").forEach((link) => {
        if (AFFILIATE_URL.trim()) { link.href = AFFILIATE_URL; return; }
        link.href = "#"; link.setAttribute("aria-disabled", "true"); link.addEventListener("click", (event) => event.preventDefault());
      });
      const slides = Array.from(document.querySelectorAll(".slide"));
      const dots = Array.from(document.querySelectorAll("[data-dot]"));
      let activeSlide = 0; let autoTimer;
      function showSlide(nextIndex, direction = "next") {
        const current = activeSlide; activeSlide = (nextIndex + slides.length) % slides.length;
        slides.forEach((slide, index) => {
          slide.classList.remove("is-active", "from-right", "from-left", "to-left", "to-right");
          if (index === current && index !== activeSlide) slide.classList.add(direction === "next" ? "to-left" : "to-right");
          if (index === activeSlide) slide.classList.add("is-active", direction === "next" ? "from-right" : "from-left");
        });
        dots.forEach((dot, index) => dot.classList.toggle("is-active", index === activeSlide));
      }
      function restartAutoSlide() { clearInterval(autoTimer); autoTimer = setInterval(() => showSlide(activeSlide + 1, "next"), 4200); }
      document.querySelector("[data-prev]").addEventListener("click", () => { showSlide(activeSlide - 1, "prev"); restartAutoSlide(); });
      document.querySelector("[data-next]").addEventListener("click", () => { showSlide(activeSlide + 1, "next"); restartAutoSlide(); });
      dots.forEach((dot) => dot.addEventListener("click", () => { const nextIndex = Number(dot.dataset.dot); showSlide(nextIndex, nextIndex > activeSlide ? "next" : "prev"); restartAutoSlide(); }));
      restartAutoSlide();
    </script>
  </body>
</html>`;
}

// ----------------------------------------------------------------------------
// #6 — Drafts (named, persistent) + manifest
// ----------------------------------------------------------------------------

function readManifest() {
  const p = path.join(draftsDir, "manifest.json");
  if (!fs.existsSync(p)) return { drafts: [] };
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return { drafts: [] };
  }
}

function writeManifest(manifest) {
  fs.mkdirSync(draftsDir, { recursive: true });
  fs.writeFileSync(
    path.join(draftsDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
}

function draftDirFor(slug) {
  return path.join(draftsDir, slug);
}

async function generateSite(payload) {
  const productUrl = String(
    payload.productUrl || payload.selectedUrl || "",
  ).trim();
  const category = String(payload.category || CONFIG.copy.defaultCategory).trim();
  const title = String(
    payload.title || payload.selectedTitle || category || CONFIG.copy.defaultTitle,
  ).trim();
  const slug = safeFileName(title);

  // #4 — validate affiliate URL up front; reject unsafe values.
  const affiliateCheck = validateAffiliateUrl(payload.affiliateUrl || "");
  if (!affiliateCheck.ok) {
    throw new Error(affiliateCheck.warning);
  }
  const affiliateUrl = affiliateCheck.url;

  const draftDir = draftDirFor(slug);
  fs.mkdirSync(path.join(draftDir, "assets", "product"), { recursive: true });

  const imageResults = await searchImages(title || category, productUrl);
  const images = await downloadImages(imageResults, slug, draftDir);

  // #7 — CSS is now a real file in /public, copied into the draft.
  const css = fs.readFileSync(templateCssPath, "utf8");
  fs.writeFileSync(path.join(draftDir, "index.html"), renderSite({
    title,
    category,
    productUrl,
    affiliateUrl,
    images,
  }));
  fs.writeFileSync(path.join(draftDir, "styles.css"), css);
  fs.writeFileSync(
    path.join(draftDir, "generation.json"),
    JSON.stringify(
      {
        title,
        category,
        productUrl,
        affiliateUrl: affiliateUrl ? "[set]" : "",
        imageCount: images.length,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  const manifest = readManifest();
  manifest.drafts = manifest.drafts.filter((d) => d.slug !== slug);
  manifest.drafts.unshift({
    slug,
    title,
    category,
    imageCount: images.length,
    hasAffiliate: Boolean(affiliateUrl),
    createdAt: new Date().toISOString(),
  });
  writeManifest(manifest);

  latestDraftSlug = slug;
  return {
    slug,
    previewUrl: `/preview/${slug}/`,
    imageCount: images.length,
    affiliateWarning: affiliateCheck.warning,
    draftDir,
  };
}

function getStatus() {
  let site = null;
  if (fs.existsSync(siteConfigPath)) {
    site = JSON.parse(
      fs.readFileSync(siteConfigPath, "utf8").replace(/^﻿/, ""),
    );
  }
  const hasToken = Boolean(process.env.NETLIFY_AUTH_TOKEN);
  const hasSiteId = Boolean(site && site.site_id);
  // site_id is the hard requirement. The auth token may come from .env OR a
  // global `netlify login`; we surface which is missing for clarity.
  const missing = [];
  if (!hasSiteId) missing.push("site_id (netlify-site.local.json)");
  if (!hasToken) missing.push("NETLIFY_AUTH_TOKEN (.env) or `netlify login`");
  return {
    site,
    drafts: readManifest().drafts,
    latestDraft: latestDraftSlug,
    hasNetlifyToken: hasToken,
    publishReady: hasSiteId,
    publishMissing: missing,
  };
}

// #3 + #1 — publish uses the pinned local netlify-cli via npx, deploying a
// chosen draft (defaults to the latest).
function publishSite(slug) {
  return new Promise((resolve, reject) => {
    const targetSlug = slug || latestDraftSlug;
    if (!targetSlug) {
      reject(new Error("Generate a site before publishing."));
      return;
    }
    const dir = draftDirFor(targetSlug);
    if (!fs.existsSync(path.join(dir, "index.html"))) {
      reject(new Error(`Draft "${targetSlug}" has no index.html.`));
      return;
    }
    const site = getStatus().site;
    if (!site || !site.site_id) {
      reject(
        new Error(
          "Publish not configured: missing site_id. Add it to netlify-site.local.json (copy from netlify-site.example.json and fill in your Netlify site id).",
        ),
      );
      return;
    }
    // Prefer an explicit token; otherwise let the Netlify CLI use its global
    // login (from `npx netlify-cli login`). Only block on a token if the CLI
    // isn't authenticated — but that's surfaced by the CLI itself.
    const token = process.env.NETLIFY_AUTH_TOKEN;
    const args = [
      "--yes",
      "netlify-cli",
      "deploy",
      "--prod",
      "--json",
      "--dir",
      dir,
      "--site",
      site.site_id,
      // Deploy the folder as-is: no build step (static HTML/CSS/JS).
      "--no-build",
    ];
    // Pass the token explicitly when present so npx netlify-cli always
    // authenticates, regardless of global Netlify login state.
    const childEnv = token ? { ...process.env, NETLIFY_AUTH_TOKEN: token } : process.env;
    const child = spawn("npx", args, {
      cwd: root,
      env: childEnv,
      shell: process.platform === "win32",
    });
    let output = "";
    let errorOutput = "";
    child.stdout.on("data", (data) => (output += data.toString()));
    child.stderr.on("data", (data) => (errorOutput += data.toString()));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(errorOutput || output || `Netlify deploy failed with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(output));
      } catch {
        resolve({ output });
      }
    });
  });
}

// ----------------------------------------------------------------------------
// Static serving (supports /preview/<slug>/ routing for #6)
// ----------------------------------------------------------------------------

function serveStatic(req, res, baseDir, prefix = "") {
  const url = new URL(req.url, "http://localhost");
  let relative = decodeURIComponent(url.pathname.slice(prefix.length));
  if (!relative || relative.endsWith("/")) relative += "index.html";
  const filePath = path.normalize(path.join(baseDir, relative));
  if (!filePath.startsWith(baseDir)) {
    send(res, 403, "Forbidden", "text/plain; charset=utf-8");
    return true;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile())
    return false;
  res.writeHead(200, {
    "Content-Type":
      mime[path.extname(filePath).toLowerCase()] || "application/octet-stream",
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function servePreview(req, res) {
  const url = new URL(req.url, "http://localhost");
  // /preview/            -> latest draft
  // /preview/<slug>/     -> that draft
  let rest = url.pathname.slice("/preview/".length);
  let slug = latestDraftSlug;
  if (rest && rest !== "/") {
    slug = rest.split("/")[0];
  }
  if (!slug) {
    send(res, 404, "No draft generated yet.", "text/plain; charset=utf-8");
    return true;
  }
  const dir = draftDirFor(slug);
  if (!fs.existsSync(dir)) {
    send(res, 404, `Draft "${slug}" not found.`, "text/plain; charset=utf-8");
    return true;
  }
  if (serveStatic(req, res, dir, `/preview/${slug}/`)) return true;
  // Fallback: serve from the draft root ignoring the slug prefix.
  return serveStatic(req, res, dir, "/preview/");
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/api/status") {
      send(res, 200, getStatus());
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/drafts") {
      send(res, 200, readManifest());
      return;
    }
    if (req.method === "DELETE" && /^\/api\/draft\/[^/]+$/.test(url.pathname)) {
      const slug = decodeURIComponent(url.pathname.split("/").pop());
      const dir = draftDirFor(slug);
      if (!fs.existsSync(dir)) {
        send(res, 404, { error: `Draft "${slug}" not found.` });
        return;
      }
      fs.rmSync(dir, { recursive: true, force: true });
      const manifest = readManifest();
      manifest.drafts = manifest.drafts.filter((d) => d.slug !== slug);
      writeManifest(manifest);
      if (latestDraftSlug === slug) latestDraftSlug = manifest.drafts[0]?.slug || null;
      send(res, 200, { ok: true, slug });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/search") {
      const source = url.searchParams.get("source") || "duckduckgo";
      const result = await searchWeb(
        url.searchParams.get("category") || "",
        url.searchParams.get("period") || "week",
        source,
      );
      send(res, 200, result);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/generate") {
      const result = await generateSite(await readJson(req));
      send(res, 200, result);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/publish") {
      const body = await readJson(req).catch(() => ({}));
      const result = await publishSite(body.slug || null);
      send(res, 200, result);
      return;
    }
    if (url.pathname.startsWith("/preview/")) {
      if (servePreview(req, res)) return;
    }
    if (serveStatic(req, res, publicDir)) return;
    send(res, 404, "Not found", "text/plain; charset=utf-8");
  } catch (error) {
    send(res, 500, { error: error.message });
  }
});

function startServer() {
  const port = Number(process.env.PORT || 8787);
  server.listen(port, () => {
    console.log(`Affiliate Builder UI: http://localhost:${port}`);
  });
}

// Run when executed directly; export for tests when required.
if (require.main === module) {
  startServer();
}

module.exports = {
  server,
  startServer,
  validateAffiliateUrl,
  renderSite,
  safeFileName,
  safeText,
  searchWeb,
  trendSources,
  config: CONFIG,
  marketplace: MARKET,
};
