const state = {
  selected: null,
  drafts: [],
};

const el = (id) => document.getElementById(id);

function setBusy(button, busy) {
  button.disabled = busy;
}

function setMessage(text, isError = false) {
  el("message").textContent = text;
  el("message").style.color = isError ? "#b42318" : "#666b74";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

async function loadStatus() {
  try {
    const status = await api("/api/status");
    if (status.publishReady) {
      const site = status.site?.site_url || "(Netlify site linked)";
      el("status").textContent = `Ready to publish · ${site}`;
      el("status").style.color = "#067647";
      el("publishBtn").disabled = false;
    } else {
      const missing = (status.publishMissing || []).join(", ");
      el("status").textContent = `Publish not connected — missing: ${missing || "Netlify setup"}`;
      el("status").style.color = "#b42318";
    }
  } catch (error) {
    el("status").textContent = error.message;
  }
}

// #6 — load the draft manifest and populate the picker.
async function loadDrafts(preferSlug) {
  try {
    const manifest = await api("/api/drafts");
    state.drafts = manifest.drafts || [];
    const select = el("draftSelect");
    const current = preferSlug || select.value;
    select.innerHTML = "";
    if (!state.drafts.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "— none yet —";
      select.appendChild(opt);
    } else {
      state.drafts.forEach((d) => {
        const opt = document.createElement("option");
        opt.value = d.slug;
        const aff = d.hasAffiliate ? " · linked" : " · no link";
        opt.textContent = `${d.title} (${d.imageCount} img)${aff}`;
        select.appendChild(opt);
      });
    }
    // Restore selection if still present, else pick the newest.
    if (current && state.drafts.some((d) => d.slug === current)) {
      select.value = current;
    } else if (state.drafts.length) {
      select.value = state.drafts[0].slug;
    }
    el("deleteDraftBtn").disabled = !select.value;
  } catch (error) {
    setMessage(error.message, true);
  }
}

function previewSelectedDraft() {
  const slug = el("draftSelect").value;
  if (!slug) {
    el("preview").removeAttribute("src");
    setMessage("No draft selected.");
    return;
  }
  el("preview").src = `/preview/${slug}/?t=${Date.now()}`;
}

function selectedPeriod() {
  return document.querySelector("input[name='period']:checked")?.value || "week";
}

function renderResults(results) {
  const box = el("results");
  box.innerHTML = "";
  if (!results.length) {
    box.innerHTML = `<div class="message">No Shopee results found. Paste a product link instead.</div>`;
    return;
  }

  results.forEach((result) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "result";
    button.innerHTML = `<strong>${result.title}</strong><span>${result.snippet || result.url}</span>`;
    button.addEventListener("click", () => {
      state.selected = result;
      el("productUrl").value = result.url;
      el("productTitle").value = result.title;
      document.querySelectorAll(".result").forEach((node) => node.classList.remove("is-selected"));
      button.classList.add("is-selected");
    });
    box.appendChild(button);
  });
}

el("searchBtn").addEventListener("click", async () => {
  const button = el("searchBtn");
  setBusy(button, true);
  setMessage("Searching Shopee results...");
  try {
    const data = await api(`/api/search?category=${encodeURIComponent(el("category").value)}&period=${selectedPeriod()}`);
    renderResults(data.results);
    setMessage(`Search complete. Query: ${data.query}`);
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    setBusy(button, false);
  }
});

el("generateBtn").addEventListener("click", async () => {
  const button = el("generateBtn");
  setBusy(button, true);
  setMessage("Generating page and downloading product images...");
  try {
    const data = await api("/api/generate", {
      method: "POST",
      body: JSON.stringify({
        category: el("category").value,
        productUrl: el("productUrl").value,
        title: el("productTitle").value,
        affiliateUrl: el("affiliateUrl").value,
        selectedUrl: state.selected?.url,
        selectedTitle: state.selected?.title,
      }),
    });
    el("preview").src = `${data.previewUrl}?t=${Date.now()}`;
    if (data.affiliateWarning) setMessage(data.affiliateWarning, true);
    else setMessage(`Generated "${el("productTitle").value || el("category").value}". Images: ${data.imageCount}.`);
    await loadDrafts(data.slug);
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    setBusy(button, false);
  }
});

// Preview the draft chosen in the picker (instead of always the latest).
el("draftSelect").addEventListener("change", () => {
  el("deleteDraftBtn").disabled = !el("draftSelect").value;
  previewSelectedDraft();
});

el("refreshPreviewBtn").addEventListener("click", () => {
  const slug = el("draftSelect").value;
  if (!slug) {
    setMessage("Generate or pick a draft first.");
    return;
  }
  previewSelectedDraft();
});

el("deleteDraftBtn").addEventListener("click", async () => {
  const slug = el("draftSelect").value;
  if (!slug) return;
  if (!confirm(`Delete draft "${slug}"? This removes its folder and cannot be undone.`)) return;
  const button = el("deleteDraftBtn");
  setBusy(button, true);
  try {
    await api(`/api/draft/${encodeURIComponent(slug)}`, { method: "DELETE" });
    setMessage(`Deleted draft "${slug}".`);
    await loadDrafts();
    previewSelectedDraft();
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    setBusy(button, false);
  }
});

el("publishBtn").addEventListener("click", async () => {
  const button = el("publishBtn");
  const slug = el("draftSelect").value;
  const ok = confirm(slug
    ? `Publish draft "${slug}" to the production Netlify URL?`
    : "Publish the latest generated page to the production Netlify URL?");
  if (!ok) return;
  setBusy(button, true);
  setMessage("Publishing to Netlify production...");
  try {
    const data = await api("/api/publish", {
      method: "POST",
      body: JSON.stringify(slug ? { slug } : {}),
    });
    setMessage(`Published: ${data.url || data.deploy_url || "Netlify deploy complete"}`);
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    setBusy(button, false);
  }
});

loadStatus();
loadDrafts();
