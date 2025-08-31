const api = typeof browser !== "undefined" ? browser : chrome;

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


function formatAbsolute(d) {
  try {
    const dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt)) return "N/A";
    const months = [
      "January","February","March","April","May","June",
      "July","August","September","October","November","December"
    ];
    return `${months[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}`;
  } catch {
    return "N/A";
  }
}
function plural(n, w) { return `${n} ${w}${n === 1 ? "" : "s"} ago`; }
function formatRelative(d) {
  try {
    const dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt)) return "N/A";
    const now = Date.now();
    const diffMs = now - dt.getTime();
    const sec = Math.max(0, Math.floor(diffMs / 1000));
    const min = Math.floor(sec / 60);
    const hr  = Math.floor(min / 60);
    const day = Math.floor(hr / 24);

    if (sec < 45) return "just now";
    if (min < 60) return plural(min, "minute");
    if (hr  < 24) return plural(hr, "hour");
    if (day < 60) return plural(day, "day");
    return formatAbsolute(dt);
  } catch {
    return "N/A";
  }
}
function formatWhen(s) {
  if (!s || s === "N/A") return "N/A";
  return formatRelative(s);
}

const STATUS_COLORS = {
  "new": "#8e44ad",
  "pending-program-review": "#0038bb",
  "needs-more-info": "#559cf5",
  "triaged": "#e67e22",
  "retesting": "#f3b234",
  "duplicate": "#a78260",
  "informative": "#ccc",
  "not-applicable": "#ce3f4b",
  "resolved": "#609828",
  "spam": "#555"
};
function prettyStatus(raw) {
  if (!raw || raw === "N/A") return "N/A";
  const text = String(raw).replace(/-/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
function statusBadge(raw) {
  const color = STATUS_COLORS[String(raw || "").toLowerCase()] || "#666";
  const text = prettyStatus(raw);
  return `<span class="status-badge" style="--badge:${color}">${esc(text)}</span>`;
}

function profileLink(username) {
  if (!username || username === "N/A") return esc(username || "N/A");
  const url = `https://hackerone.com/${encodeURIComponent(username)}`;
  return `<a href="${url}" target="_blank" rel="noopener">${esc(username)}</a>`;
}

function formatActionName(raw) {
  if (!raw || raw === "N/A") return "N/A";
  let name = raw.replace(/^Activities/, "");
  name = name.replace(/([A-Z])/g, " $1").trim();
  return name;
}

function render(rows) {
  const root = document.getElementById("results-root");
  root.innerHTML = `
    <div class="wrap">
      <h1>Scraping Results</h1>

      <!-- Global expand/collapse controls (outside the table, right-aligned above Last Message column) -->
      <div class="msg-controls">
        <button id="expandAll" class="btn">Expand all</button>
        <button id="collapseAll" class="btn">Collapse all</button>
      </div>
      

      <div class="filters-wrap">
        <div class="filters-header">Exclude from Results:</div>
        <div id="neg-filters" class="filters-rows"></div>
      </div>

      <table id="results-table">
        <thead>
          <tr>
            <th class="sel-col"><input type="checkbox" id="selectAll" title="Select all"></th>
            <th style="width:140px;">Report</th>
            <th style="width:220px;">Program</th>
            <th style="width:150px;">Status</th>
            <th style="width:420px;">Title</th>
            <th style="width:240px;">Last Action</th>
            <th>Last Message</th>
          </tr>
        </thead>
        <tbody id="tbody"><tr><td colspan="7" class="muted">Waiting for results…</td></tr></tbody>
      </table>
      <div class="table-actions">
        <button id="openSelected" class="open-btn" disabled>Open selected</button>
        <span id="selectionInfo" class="muted"></span>
      </div>
    </div>
  `;
  updateTable(rows);
  wireSelectionControls();
  wireExpandCollapseControls();
  setupNegativeFiltersUI();
}

function rowCheckbox(reportId) {
  return `<input type="checkbox" class="row-select" data-report-id="${esc(reportId)}" aria-label="Select #${esc(reportId)}">`;
}

function countSelected() {
  return document.querySelectorAll('.row-select:checked').length;
}

function updateOpenButtonState() {
  const btn = document.getElementById('openSelected');
  const selCount = countSelected();
  if (btn) btn.disabled = selCount === 0;
  const info = document.getElementById('selectionInfo');
  if (info) info.textContent = selCount ? `${selCount} selected` : '';
}

function wireSelectionControls() {
  const selectAll = document.getElementById('selectAll');
  const btn = document.getElementById('openSelected');

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t) return;

    if (t.id === 'selectAll') {
      const checked = t.checked;
      document.querySelectorAll('.row-select').forEach(cb => (cb.checked = checked));
      updateOpenButtonState();
      return;
    }
    if (t.classList && t.classList.contains('row-select')) {
      const all = Array.from(document.querySelectorAll('.row-select'));
      const checked = all.filter(cb => cb.checked).length;
      if (checked === 0) { selectAll.checked = false; selectAll.indeterminate = false; }
      else if (checked === all.length) { selectAll.checked = true; selectAll.indeterminate = false; }
      else { selectAll.indeterminate = true; }
      updateOpenButtonState();
    }
  });

  // Open new report tabs "discarded" (don't load until selected)
  btn.addEventListener('click', async () => {
    const selected = Array.from(document.querySelectorAll('.row-select:checked'));
    if (!selected.length) return;

    for (const cb of selected) {
      const id = cb.getAttribute('data-report-id');
      const url = `https://hackerone.com/reports/${id}`;

      try {
        if (api?.tabs?.create) {
          
// Open as deferred (background about:blank; loads on focus)
await new Promise((resolve, reject) => {
  const runtime = (typeof browser !== "undefined" ? browser : chrome).runtime;
  runtime.sendMessage({ type: 'OPEN_DEFERRED', url }, (res) => {
    const err = (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.lastError) ? chrome.runtime.lastError : null;
    if (err) return reject(err);
    if (!res || !res.ok) return reject(res && res.error ? new Error(res.error) : new Error("OPEN_DEFERRED failed"));
    resolve();
  });
});
// Spacing between tabs

          await new Promise(r => setTimeout(r, 60));
        } else {
          // Last resort: open immediately
          window.open(url, "_blank", "noopener,noreferrer");
        }
      } catch (e) {
        console.error("Failed to open/discard tab for", url, e);
      }
    }
  });

  updateOpenButtonState();
}

function showMessageForIndex(idx) {
  const tbody = document.getElementById("tbody");
  const table = document.getElementById("results-table");
  if (!tbody || !table) return;

  const existing = tbody.querySelector(`tr.msg-row[data-msg-for="${idx}"]`);
  if (existing) return;

  const mainRow = tbody.querySelector(`tr[data-row="${idx}"]`);
  if (!mainRow) return;

  const r = (table._rowsCache && table._rowsCache[idx]) || {};
  const msgHTML = makeMessageRow(r, idx);
  mainRow.insertAdjacentHTML("afterend", msgHTML);

  const btn = tbody.querySelector(`button.show-msg[data-idx="${idx}"]`);
  if (btn) btn.textContent = "(Hide)";
}

function hideMessageForIndex(idx) {
  const tbody = document.getElementById("tbody");
  if (!tbody) return;

  const existing = tbody.querySelector(`tr.msg-row[data-msg-for="${idx}"]`);
  if (existing) existing.remove();

  const btn = tbody.querySelector(`button.show-msg[data-idx="${idx}"]`);
  if (btn) btn.textContent = "(Show)";
}

function wireExpandCollapseControls() {
  const expand = document.getElementById("expandAll");
  const collapse = document.getElementById("collapseAll");
  const table = document.getElementById("results-table");
  if (!expand || !collapse || !table) return;

  expand.addEventListener("click", () => {
    const rows = table._rowsCache || [];
    for (let i = 0; i < rows.length; i++) showMessageForIndex(i);
  });

  collapse.addEventListener("click", () => {
    const rows = table._rowsCache || [];
    for (let i = 0; i < rows.length; i++) hideMessageForIndex(i);
  });
}

function makeMainRow(r, idx) {
  const link = `https://hackerone.com/reports/${esc(r.reportId)}`;
  const title = esc(r.title || "N/A");
  const program = esc(r.program || "N/A");

  const actionBlock = `
    <div>${profileLink(r.lastActionAuthor)}</div>
    <div>${esc(formatWhen(r.lastActionDate))}</div>
    <div><strong>${esc(formatActionName(r.lastAction))}</strong></div>
  `;

  const messageHeader = `
    <div>${profileLink(r.lastMessageAuthor)}<br>${esc(formatWhen(r.lastMessageDate))}</div>
    <button class="btn show-msg" data-idx="${idx}">(Show)</button>
  `;

  const titleBlock = `
    <span class="title">
      <span class="title-title" title="${title}">${title}</span>
      <span class="title-by">by ${profileLink(r.researcher)}</span>
    </span>
  `;

  return `
    <tr data-row="${idx}">
      <td class="sel-col">${rowCheckbox(r.reportId)}</td>
      <td><a href="${link}" target="_blank" rel="noopener">#${esc(r.reportId)}</a></td>
      <td>${program}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${titleBlock}</td>
      <td>${actionBlock}</td>
      <td>${messageHeader}</td>
    </tr>
  `;
}

function makeMessageRow(r, idx) {
  return `
    <tr class="msg-row" data-msg-for="${idx}">
      <td colspan="7">
        <div class="msg-body">${esc(r.lastMessage || "N/A")}</div>
      </td>
    </tr>
  `;
}

function updateTable(rows) {
  const tbody = document.getElementById("tbody");
  if (!tbody) return;

  if (!rows || rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">No results.</td></tr>`;
    updateOpenButtonState();
    return;
  }

  tbody.innerHTML = rows.map((r, idx) => makeMainRow(r, idx)).join("");

  if (!tbody._hasMsgClick) {
    tbody.addEventListener("click", (e) => {
      const btn = e.target.closest("button.show-msg");
      if (!btn) return;
      const idx = btn.getAttribute("data-idx");
      const existing = tbody.querySelector(`tr.msg-row[data-msg-for="${idx}"]`);
      if (existing) { hideMessageForIndex(idx); return; }
      showMessageForIndex(idx);
    });
    tbody._hasMsgClick = true;
  }

  const table = document.getElementById("results-table");
  table._rowsCache = rows;

  const selectAll = document.getElementById('selectAll');
  if (selectAll) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
  }
  updateOpenButtonState();
}

async function init() {
  render([]);
  let { scrapeResults = [] } = await api.storage.local.get("scrapeResults");
  refreshFiltersWithNewData(scrapeResults);
api.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.scrapeResults) { const rows = changes.scrapeResults.newValue || []; refreshFiltersWithNewData(rows); }
  });
}

// Negative Filters (Exclude matching rows)
function getTableEl() { return document.getElementById("results-table"); }
function ensureOriginalRows(rows) { const t = getTableEl(); if (t) t._originalRows = Array.isArray(rows) ? rows.slice() : []; }
function currentOriginalRows() { const t = getTableEl(); return (t && Array.isArray(t._originalRows)) ? t._originalRows.slice() : []; }

function getAllActions(rows) {
  const set = new Set();
  (rows || []).forEach(r => { if (r.lastAction && r.lastAction !== "N/A") set.add(r.lastAction); });
  return Array.from(set).sort((a,b) => formatActionName(a).localeCompare(formatActionName(b)));
}
function getAuthorsForAction(action, rows) {
  const set = new Set();
  (rows || []).forEach(r => { if (r.lastAction === action && r.lastActionAuthor && r.lastActionAuthor !== "N/A") set.add(r.lastActionAuthor); });
  return Array.from(set).sort((a,b) => a.localeCompare(b));
}

function makeFilterRowDOM(idx, actions, selectedAction = "", authors = [], selectedAuthor = "") {
  const row = document.createElement("div");
  row.className = "filter-row";
  row.dataset.index = String(idx);
  row.innerHTML = `
    <label>Last Action:</label>
    <select class="nf-action">
      <option value="">None</option>
      ${actions.map(a => `<option value="${esc(a)}"${a===selectedAction?' selected':''}>${esc(formatActionName(a))}</option>`).join("")}
    </select>
    <span class="and-token">AND</span>
    <label>Action Author:</label>
    <select class="nf-author" ${selectedAction ? "" : "disabled"}>
      <option value="">None</option>
      ${authors.map(u => `<option value="${esc(u)}"${u===selectedAuthor?' selected':''}>${esc(u)}</option>`).join("")}
    </select>
    <span class="btn-group">
      <button class="btn btn-primary nf-add" title="Add another exclusion">+</button>
      <button class="btn btn-primary nf-remove" title="Remove this exclusion">-</button>
    </span>
  `;
  return row;
}

function readFiltersFromDOM() {
  return Array.from(document.querySelectorAll(".filter-row")).map(fr => {
    const action = fr.querySelector(".nf-action")?.value || "";
    const author = fr.querySelector(".nf-author")?.value || "";
    return { action, author };
  });
}

function applyNegativeFiltersAndRender() {
  const originals = currentOriginalRows();
  const filters = readFiltersFromDOM().filter(f => f.action && f.author);
  if (filters.length === 0) { updateTable(originals); return; }
  const filtered = originals.filter(r => !filters.some(f => r.lastAction === f.action && r.lastActionAuthor === f.author));
  updateTable(filtered);
  const selectAll = document.getElementById('selectAll');
  if (selectAll) { selectAll.checked = false; selectAll.indeterminate = false; }
  updateOpenButtonState();
}

function rebuildAuthorsForRow(fr) {
  const actionSel = fr.querySelector(".nf-action");
  const authorSel = fr.querySelector(".nf-author");
  const chosenAction = actionSel?.value || "";
  const originals = currentOriginalRows();
  const authors = chosenAction ? getAuthorsForAction(chosenAction, originals) : [];
  authorSel.innerHTML = `<option value="">None</option>` + authors.map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join("");
  authorSel.disabled = !chosenAction;
}

function setupNegativeFiltersUI() {
  const wrap = document.getElementById("neg-filters");
  if (!wrap) return;
  const originals = currentOriginalRows();
  const actions = getAllActions(originals);
  wrap.innerHTML = "";
  wrap.appendChild(makeFilterRowDOM(0, actions));
  wrap.addEventListener("change", (e) => {
    const t = e.target;
    const fr = t.closest(".filter-row");
    if (!fr) return;
    if (t.classList.contains("nf-action")) { rebuildAuthorsForRow(fr); }
    else if (t.classList.contains("nf-author")) { applyNegativeFiltersAndRender(); }
  });
  wrap.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const fr = btn.closest(".filter-row");
    if (!fr) return;
    if (btn.classList.contains("nf-add")) {
      const idx = document.querySelectorAll(".filter-row").length;
      const actions = getAllActions(currentOriginalRows());
      fr.after(makeFilterRowDOM(idx, actions));
      e.preventDefault(); return;
    }
    if (btn.classList.contains("nf-remove")) {
      const rows = Array.from(document.querySelectorAll(".filter-row"));
      if (rows.length > 1) { fr.remove(); applyNegativeFiltersAndRender(); }
      else {
        fr.querySelector(".nf-action").value = "";
        const u = fr.querySelector(".nf-author"); u.value = ""; u.disabled = true; u.innerHTML = `<option value="">None</option>`;
        updateTable(currentOriginalRows());
      }
      e.preventDefault(); return;
    }
  });
}

function refreshFiltersWithNewData(rows) {
  ensureOriginalRows(rows);
  const wrap = document.getElementById("neg-filters");
  if (!wrap) return;
  const prev = readFiltersFromDOM();
  const actions = getAllActions(rows);
  wrap.innerHTML = "";
  const toBuild = prev.length ? prev : [{action:"", author:""}];
  toBuild.forEach((p,i) => {
    const authors = p.action ? getAuthorsForAction(p.action, rows) : [];
    wrap.appendChild(makeFilterRowDOM(i, actions, p.action, authors, p.author));
  });
  applyNegativeFiltersAndRender();
}
init();
