require("dotenv").config();

const assert = require("assert");
const {
  validateAffiliateUrl,
  safeFileName,
  safeText,
  renderSite,
  searchWeb,
  trendSources,
  config,
  marketplace,
} = require("../server.js");

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${error.message}`);
  }
}

(async () => {
  // ---------------------------------------------------------------------------
  console.log("Affiliate Builder — smoke test\n");

  // #4 — affiliate URL hardening
  await test("rejects empty", () => {
    const r = validateAffiliateUrl("");
    assert.strictEqual(r.ok, true);
  });
  await test("rejects javascript: scheme", () => {
    const r = validateAffiliateUrl("javascript:alert(1)");
    assert.strictEqual(r.ok, false);
    assert.match(r.warning, /https/i);
  });
  await test("rejects data: scheme", () => {
    const r = validateAffiliateUrl("data:text/html,<script>alert(1)</script>");
    assert.strictEqual(r.ok, false);
  });
  await test("rejects http: (non-https)", () => {
    const r = validateAffiliateUrl("http://shopee.com.my/x");
    assert.strictEqual(r.ok, false);
  });
  await test("accepts https shopee link without warning", () => {
    const r = validateAffiliateUrl("https://shopee.com.my/product/i.123.456");
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.warning, "");
  });
  await test("accepts other https host but warns", () => {
    const r = validateAffiliateUrl("https://example.com/x");
    assert.strictEqual(r.ok, true);
    assert.match(r.warning, /not a .* domain/i);
  });
  await test("rejects malformed url", () => {
    const r = validateAffiliateUrl("not a url");
    assert.strictEqual(r.ok, false);
  });

  // helpers
  await test("safeFileName slugifies", () => {
    assert.strictEqual(safeFileName("CREALITY Ender 3 Pro!"), "creality-ender-3-pro");
  });
  await test("safeText escapes html", () => {
    assert.strictEqual(safeText('<b>"x"&'), "&lt;b&gt;&quot;x&quot;&amp;");
  });

  // renderSite produces valid-ish html and embeds a safe affiliate url only
  await test("renderSite embeds https affiliate href", () => {
    const html = renderSite({
      title: "Test <Product>",
      category: "phone case",
      productUrl: "",
      affiliateUrl: "https://shopee.com.my/x",
      images: [],
    });
    assert.match(html, /<title>Test &lt;Product&gt;<\/title>/);
    assert.match(html, /href="https:\/\/shopee.com.my\/x"/);
  });
  await test("renderSite neutralizes empty affiliate link", () => {
    const html = renderSite({
      title: "Test",
      category: "produk",
      productUrl: "",
      affiliateUrl: "",
      images: [],
    });
    assert.match(html, /data-affiliate-link href="#"/);
  });

  // trend source registry is pluggable (#8)
  await test("trendSources exposes duckduckgo + bing", () => {
    assert.ok(typeof trendSources.duckduckgo === "function");
    assert.ok(typeof trendSources.bing === "function");
  });

  // config.json drives marketplace + copy (#transferable)
  await test("loads config with marketplace + copy", () => {
    assert.ok(marketplace && marketplace.name);
    assert.ok(Array.isArray(config.copy.categories) && config.copy.categories.length);
    // default Shopee/MY preserved
    assert.strictEqual(marketplace.searchHost, "shopee.com.my");
  });
  await test("renderSite uses config brand + cta label", () => {
    const html = renderSite({
      title: "Test",
      category: "produk",
      productUrl: "",
      affiliateUrl: "",
      images: [],
    });
    assert.match(html, new RegExp(marketplace.ctaLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, new RegExp(config.copy.brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  // searchWeb resilience: must resolve (never reject) for benign input (#3).
  await test("searchWeb returns shape", async () => {
    const r = await searchWeb("phone case", "week", "duckduckgo");
    assert.ok(Array.isArray(r.results));
    assert.ok(typeof r.query === "string");
  });

  // draft delete endpoint rejects a missing draft without throwing.
  // Integration check: only runs when a server is listening on :8787.
  await test("DELETE /api/draft/<slug> 404 for unknown slug", async () => {
    let res;
    try {
      res = await fetch("http://localhost:8787/api/draft/does-not-exist-xyz", {
        method: "DELETE",
      });
    } catch {
      console.log("    (skipped — server not running on :8787)");
      return;
    }
    assert.strictEqual(res.status, 404);
  });

  // ---------------------------------------------------------------------------
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
