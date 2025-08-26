const api = typeof browser !== "undefined" ? browser : chrome;

function ensureTheme() {
  if (document.getElementById("h1-theme-css")) return;
  try {
    const link = document.createElement("link");
    link.id = "h1-theme-css";
    link.rel = "stylesheet";
    link.href = api.runtime.getURL("theme.css");
    document.documentElement.append(link);
  } catch (e) {
    console.warn("Could not inject theme.css:", e);
  }
}

function getCSRFToken() {
  const meta = document.querySelector('meta[name="csrf-token"]');
  return meta?.content || null;
}

async function waitForCSRF(timeoutMs = 7000) {
  const start = Date.now();
  let token = getCSRFToken();
  while (!token && Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 100));
    token = getCSRFToken();
  }
  if (!token) throw new Error("CSRF token not found on page");
  return token;
}

function fillTemplate(template, reportId) {
  return template
    .replace(/\[report_id\]/g, String(reportId))
    .replace(/\[reportId\]/g, String(reportId));
}

async function postGraphQL(bodyString, csrfToken) {
  const res = await fetch("/graphql", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Csrf-Token": csrfToken,
      "Accept": "application/json"
    },
    body: bodyString
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors) {
    console.error("GraphQL errors:", json.errors || res.statusText);
    throw new Error(json.errors?.[0]?.message || `GraphQL status ${res.status}`);
  }
  return json;
}

function extractFromMetadata(json) {
  const node = json?.data?.reports?.edges?.[0]?.node || {};
  return {
    status: node?.substate ?? "N/A",
    researcher: node?.reporter?.username ?? "N/A",
    title: node?.title ?? "N/A",
    programName: node?.team?.name ?? "N/A",
  };
}

function extractFromTimeline(json) {
  const edges = json?.data?.reports?.nodes?.[0]?.activities?.edges || [];

  const lastActionEdge = edges[0]?.node;
  const lastAction = lastActionEdge?.type ?? "N/A";
  const lastActionAuthor = lastActionEdge?.actor?.username ?? "N/A";
  const lastActionDate = lastActionEdge?.created_at ?? "N/A";

  const msgEdgeNode = (edges.find(e => {
    const m = e?.node?.message;
    return typeof m === "string" && m.trim().length > 0;
  }) || {}).node;

  const lastMessage = msgEdgeNode?.message ?? "N/A";
  const lastMessageAuthor = msgEdgeNode?.actor?.username ?? "N/A";
  const lastMessageDate = msgEdgeNode?.created_at ?? "N/A";

  return { lastAction, lastActionAuthor, lastActionDate, lastMessage, lastMessageAuthor, lastMessageDate };
}

async function scrapeOne(reportId, csrfToken, templates) {
  const metaBody = fillTemplate(templates.metadataTemplate, reportId);
  const timeBody = fillTemplate(templates.timelineTemplate, reportId);

  const [metaJson, timeJson] = await Promise.all([
    postGraphQL(metaBody, csrfToken),
    postGraphQL(timeBody, csrfToken)
  ]);

  const meta = extractFromMetadata(metaJson);
  const time = extractFromTimeline(timeJson);

  return {
    reportId: String(reportId),
    status: meta.status,
    researcher: meta.researcher,
    title: meta.title,
    program: meta.programName,
    lastAction: time.lastAction,
    lastActionAuthor: time.lastActionAuthor,
    lastActionDate: time.lastActionDate,
    lastMessage: time.lastMessage,
    lastMessageAuthor: time.lastMessageAuthor,
    lastMessageDate: time.lastMessageDate
  };
}

async function scrapeInBatches(reportIds, batchSize, templates) {
  const csrfToken = await waitForCSRF();
  const results = [];
  for (let i = 0; i < reportIds.length; i += batchSize) {
    const slice = reportIds.slice(i, i + batchSize);
    const batch = await Promise.all(slice.map(id =>
      scrapeOne(id, csrfToken, templates).catch(err => {
        console.warn(`Failed report ${id}:`, err);
        return {
          reportId: String(id),
          status: "N/A",
          researcher: "N/A",
          title: "N/A",
          program: "N/A",
          lastAction: "N/A",
          lastActionAuthor: "N/A",
          lastActionDate: "N/A",
          lastMessage: "N/A",
          lastMessageAuthor: "N/A",
          lastMessageDate: "N/A"
        };
      })
    ));
    results.push(...batch);
    await new Promise(r => setTimeout(r, 120));
    setOverlay(`Processed ${Math.min(i + batchSize, reportIds.length)} / ${reportIds.length}…`);
  }
  return results;
}

function ensureOverlay() {
  if (document.getElementById("h1-scrape-overlay")) return;
  const el = document.createElement("div");
  el.id = "h1-scrape-overlay";
  el.innerHTML = `
    <div class="inner">
      <h2>Scraping HackerOne reports…</h2>
      <p id="h1-overlay-status">Starting…</p>
    </div>
  `;
  ensureTheme();
  document.documentElement.append(el);
}
function setOverlay(text){ const p=document.getElementById("h1-overlay-status"); if(p) p.textContent=text; }

api.runtime.onMessage.addListener(async (msg) => {
  if (msg?.type !== "START_SCRAPE") return;

  try {
    ensureOverlay();
    setOverlay("Loading CSRF & queries…");

    const reportIds = (msg.reportIds || []).map(x => parseInt(String(x).trim(), 10)).filter(n => Number.isFinite(n));
    const batchSize = msg.batchSize || 5;
    const templates = { metadataTemplate: msg.metadataTemplate, timelineTemplate: msg.timelineTemplate };

    setOverlay(`Scraping ${reportIds.length} reports…`);
    const results = await scrapeInBatches(reportIds, batchSize, templates);

    await api.storage.local.set({
      scrapeResults: results,
      scrapeResults_count: results.length,
      scrapeResults_ts: Date.now()
    });

    setOverlay("Done. Opening results…");
    await api.runtime.sendMessage({ type: "SCRAPE_DONE" });
    setTimeout(() => {
      const o = document.getElementById("h1-scrape-overlay");
      if (o) o.remove();
    }, 600);
  } catch (e) {
    console.error("Scrape failed:", e);
    ensureOverlay();
    setOverlay(`Error: ${e.message || e}`);
  }
});
