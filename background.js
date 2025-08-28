const api = typeof browser !== "undefined" ? browser : chrome;

// Chrome-specific deferred tab opener (no preload)
async function _getDeferredMap() {
  const store = (api.storage && api.storage.session) ? api.storage.session : (api.storage && api.storage.local);
  const got = store ? await store.get("deferredTabs") : {};
  return (got && got.deferredTabs) || {};
}
async function _setDeferredMap(map) {
  const store = (api.storage && api.storage.session) ? api.storage.session : (api.storage && api.storage.local);
  if (store && store.set) await store.set({ deferredTabs: map });
}
async function _rememberDeferred(tabId, url) {
  const map = await _getDeferredMap();
  map[tabId] = url;
  await _setDeferredMap(map);
}
async function _takeDeferred(tabId) {
  const map = await _getDeferredMap();
  const url = map[tabId];
  if (url) { delete map[tabId]; await _setDeferredMap(map); }
  return url;
}
function openDeferred(url) {
  return new Promise((resolve, reject) => {
    try {
      api.tabs.create({ url: "about:blank", active: false }, (tab) => {
        const err = api.runtime && api.runtime.lastError;
        if (err) return reject(err);
        _rememberDeferred(tab.id, url).then(() => resolve(tab.id)).catch(reject);
      });
    } catch (e) { reject(e); }
  });
}
if (api.tabs && api.tabs.onActivated && api.tabs.onActivated.addListener) {
  api.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
      const url = await _takeDeferred(tabId);
      if (url) {
        await new Promise((resolve, reject) => {
          api.tabs.update(tabId, { url }, () => {
            const err = api.runtime && api.runtime.lastError;
            if (err) reject(err); else resolve();
          });
        });
      }
    } catch (e) { console.warn("Deferred navigation failed:", e); }
  });
}
if (api.tabs && api.tabs.onRemoved && api.tabs.onRemoved.addListener) {
  api.tabs.onRemoved.addListener(async (tabId) => {
    const map = await _getDeferredMap();
    if (map[tabId]) { delete map[tabId]; await _setDeferredMap(map); }
  });
}
api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "OPEN_DEFERRED" && msg.url) {
    (async () => {
      try {
        const tabId = await openDeferred(msg.url);
        sendResponse({ ok: true, tabId });
      } catch (e) {
        sendResponse({ ok: false, error: (e && e.message) || String(e) });
      }
    })();
    return true;
  }
});
// End Chrome-specific tab opener

// Track the temporary H1 tab
let tempH1TabId = null;

// Load raw JSON GraphQL query templates
async function loadQueryTemplates() {
  const meta = await fetch(api.runtime.getURL("queries/metadata.txt")).then(r => r.text());
  const time = await fetch(api.runtime.getURL("queries/timeline.txt")).then(r => r.text());
  return { metadataTemplate: meta.trim(), timelineTemplate: time.trim() };
}

function parseReportInput(text) {
  // Accept IDs or full URLs; normalize to numeric IDs and dedupe while preserving order
  const seen = new Set();
  return text
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      const m = s.match(/reports\/(\d+)/) || s.match(/^(\d+)$/);
      return m ? m[1] : null;
    })
    .filter(Boolean)
    .filter(id => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

async function ensureH1Tab() {
  const tabs = await api.tabs.query({ active: true, currentWindow: true });
  const active = tabs[0];
  if (active && active.url && active.url.startsWith("https://hackerone.com/")) {
    return { tabId: active.id, created: false };
  }
  // Open/focus a HackerOne tab
  const createdTab = await api.tabs.create({ url: "https://hackerone.com/hacktivity/overview", active: true });
  // Wait until it's ready
  await new Promise(resolve => {
    const listener = (tabId, changeInfo) => {
      if (tabId === createdTab.id && changeInfo.status === "complete") {
        api.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    api.tabs.onUpdated.addListener(listener);
  });
  return { tabId: createdTab.id, created: true };
}

// Receive a request from popup to start scraping
api.runtime.onMessage.addListener(async (msg, sender) => {
  if (msg?.type === "BEGIN_SCRAPE") {
    const reportIds = parseReportInput(msg.reportsRaw || "");
    if (reportIds.length === 0) return { ok: false, reason: "No report IDs" };

    const { tabId, created } = await ensureH1Tab();
    // Remember temporary H1 tab to use for results
    tempH1TabId = created ? tabId : null;

    const templates = await loadQueryTemplates();

    await api.storage.local.remove(["scrapeResults", "scrapeResults_ts", "scrapeResults_count"]);
    await api.tabs.sendMessage(tabId, {
      type: "START_SCRAPE",
      reportIds,
      batchSize: 5,
      ...templates
    }).catch(() => {
      // Retry if content script not ready
      setTimeout(() => {
        api.tabs.sendMessage(tabId, {
          type: "START_SCRAPE",
          reportIds,
          batchSize: 5,
          ...templates
        }).catch(err => console.error("Failed to reach content script:", err));
      }, 300);
    });

    return { ok: true };
  }

  if (msg?.type === "SCRAPE_DONE") {
    const resultsUrl = api.runtime.getURL("results.html");

    if (tempH1TabId != null) {
      // Reuse created H1 tab
      try {
        const tab = await api.tabs.get(tempH1TabId);
        if (tab && tab.id) {
          await api.tabs.update(tab.id, { url: resultsUrl, active: true });
          tempH1TabId = null;
          return { ok: true, reused: true };
        }
      } catch {
        // Fall back to new results tab if tab closed
      }
      tempH1TabId = null;
    }

    // Default behavior (started on H1 tab or fallback)
    await api.tabs.create({ url: resultsUrl, active: true });
    return { ok: true, reused: false };
  }
});
