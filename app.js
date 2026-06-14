/*
 * app.js — browser side of the leaderboard.
 *
 * Flow: fetch the .xlsx -> parse with SheetJS -> normalize the four registers
 * and the vendor list -> run the SHARED scoring.js -> render the ranked table.
 * Stage 2 adds RAG colour badges and click-to-sort columns.
 * (Summary panel and drill-down are layered on later.)
 */
(function () {
  "use strict";

  const DATA_FILE = "Vendor_Leaderboard_SAMPLE.xlsx";

  // Columns shown in the leaderboard. `key` maps to a field on a score object.
  // `sortable: false` for the position column; `type` drives sort behaviour.
  const COLUMNS = [
    { key: "rank", label: "#", sortable: false },
    { key: "company", label: "Company", type: "text" },
    { key: "totalOverdue", label: "Total Overdue", type: "num" },
    { key: "totalOpen", label: "Total Open", type: "num" },
    { key: "openObs", label: "Open Obs", type: "num" },
    { key: "openPunch", label: "Open Punch", type: "num" },
    { key: "openActions", label: "Open Actions", type: "num" },
    { key: "overdueObs", label: "Overdue Obs", type: "num" },
    { key: "overduePunch", label: "Overdue Punch", type: "num" },
    { key: "overdueActions", label: "Overdue Actions", type: "num" },
    { key: "overdueQAQC", label: "Overdue QAQC", type: "num" },
    { key: "rag", label: "RAG", type: "rag" },
  ];

  const RAG_SEVERITY = { RED: 2, AMBER: 1, GREEN: 0 };

  const $ = (sel) => document.querySelector(sel);
  const clean = (v) => (v == null ? "" : String(v).trim());

  // App state: the computed scores, the raw registers (for drill-down), the
  // current sort, and which vendor (if any) is expanded.
  const state = {
    scores: [],
    registers: null,
    sortKey: "totalOverdue",
    sortDir: "desc",
    selected: null,
  };

  const escapeHtml = (v) =>
    String(v == null ? "" : v).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));

  async function loadWorkbook() {
    const res = await fetch(DATA_FILE);
    if (!res.ok) throw new Error(`Could not load ${DATA_FILE} (HTTP ${res.status})`);
    const buf = await res.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = (name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null });

    const registers = {
      obs: sheet("Observations"),
      punch: sheet("Punch_List"),
      actions: sheet("Actions"),
      qaqc: sheet("QAQC_Items"),
    };

    // Vendor list = Company column of Lookups (so zero-item vendors still appear).
    const vendors = sheet("Lookups")
      .map((r) => r.Company)
      .filter((v) => v != null && String(v).trim() !== "");

    return { registers, vendors };
  }

  // Sortable value for a score object: numeric for counts, severity for RAG,
  // lowercased string for company.
  function sortValue(score, key) {
    const col = COLUMNS.find((c) => c.key === key);
    if (col && col.type === "rag") return RAG_SEVERITY[score.rag] ?? -1;
    if (col && col.type === "text") return clean(score.company).toLowerCase();
    return Number(score[key]);
  }

  // Comparator with consistent tie-breaks (Total Open desc, then name) so that
  // sorting by Total Overdue desc reproduces the scorecard ranking exactly.
  function comparator(key, dir) {
    const sign = dir === "asc" ? 1 : -1;
    return (a, b) => {
      const va = sortValue(a, key);
      const vb = sortValue(b, key);
      if (va < vb) return -1 * sign;
      if (va > vb) return 1 * sign;
      if (b.totalOpen !== a.totalOpen) return b.totalOpen - a.totalOpen;
      return clean(a.company).localeCompare(clean(b.company));
    };
  }

  function sortedScores() {
    return state.scores.slice().sort(comparator(state.sortKey, state.sortDir));
  }

  function cellHtml(col, row) {
    if (col.type === "rag") {
      const rag = row.rag;
      return `<td><span class="rag rag-${rag.toLowerCase()}">${rag}</span></td>`;
    }
    return `<td>${row[col.key]}</td>`;
  }

  function renderHead() {
    const arrow = (dir) => (dir === "asc" ? " ▲" : " ▼");
    const cells = COLUMNS.map((c) => {
      if (!c.sortable && c.sortable !== undefined && c.sortable === false) {
        return `<th class="not-sortable">${c.label}</th>`;
      }
      const active = c.key === state.sortKey;
      const cls = "sortable" + (active ? " active" : "");
      const ind = active ? arrow(state.sortDir) : "";
      return `<th class="${cls}" data-key="${c.key}" title="Click to sort">${c.label}${ind}</th>`;
    }).join("");
    $("#leaderboard thead").innerHTML = `<tr>${cells}</tr>`;
  }

  function renderBody() {
    const rows = sortedScores();
    $("#leaderboard tbody").innerHTML = rows
      .map((s, i) => {
        const row = { ...s, rank: i + 1 };
        const tds = COLUMNS.map((c) => cellHtml(c, row)).join("");
        const sel = s.company === state.selected ? " selected" : "";
        return `<tr class="vendor-row${sel}" tabindex="0" data-company="${escapeHtml(
          s.company
        )}">${tds}</tr>`;
      })
      .join("");
  }

  function renderSummary() {
    const s = Scoring.summarize(state.scores);
    const cards = [
      { label: "Vendors", value: s.vendorCount, cls: "" },
      { label: "In RED", value: s.redCount, cls: "card-red" },
      { label: "Total Overdue (programme)", value: s.totalOverdue, cls: "card-accent" },
      { label: "Total Open (programme)", value: s.totalOpen, cls: "" },
    ];
    const panel = $("#summary");
    panel.innerHTML = cards
      .map(
        (c) =>
          `<div class="card ${c.cls}"><div class="card-value">${c.value}</div>` +
          `<div class="card-label">${c.label}</div></div>`
      )
      .join("");
    panel.hidden = false;
  }

  function stateBadges(item) {
    let html = "";
    if (item.open) html += `<span class="pill pill-open">OPEN</span>`;
    if (item.overdue)
      html += `<span class="pill pill-overdue">OVERDUE ${item.daysOverdue}d</span>`;
    return html;
  }

  function renderDrilldown(company) {
    const panel = $("#drilldown");
    const items = Scoring.vendorItems(company, state.registers);

    const head =
      `<div class="dd-header"><h2>${escapeHtml(company)} &mdash; items behind the score</h2>` +
      `<button id="dd-close" class="dd-close" aria-label="Close">&times;</button></div>`;

    let body;
    if (items.length === 0) {
      body = `<p class="dd-empty">No open or overdue items &mdash; this vendor is all clear. 🎉</p>`;
    } else {
      const rows = items
        .map((it) => {
          const cat = it.stage ? `${it.category} · ${it.stage}` : it.category;
          return (
            "<tr>" +
            `<td>${escapeHtml(it.register)}</td>` +
            `<td>${escapeHtml(it.id)}</td>` +
            `<td>${escapeHtml(cat)}</td>` +
            `<td>${escapeHtml(it.status)}</td>` +
            `<td>${escapeHtml(it.priority || "—")}</td>` +
            `<td>${escapeHtml(it.dueDate)}</td>` +
            `<td class="num">${it.daysOverdue}</td>` +
            `<td>${stateBadges(it)}</td>` +
            "</tr>"
          );
        })
        .join("");
      body =
        `<p class="dd-count">${items.length} item(s) driving this vendor's open/overdue scores.</p>` +
        `<table class="detail"><thead><tr>` +
        `<th>Register</th><th>ID</th><th>System / Type</th><th>Status</th>` +
        `<th>Priority</th><th>Due Date</th><th class="num">Days Overdue</th><th>State</th>` +
        `</tr></thead><tbody>${rows}</tbody></table>`;
    }

    panel.innerHTML = head + body;
    panel.hidden = false;
    $("#dd-close").addEventListener("click", closeDrilldown);
  }

  function selectVendor(company) {
    state.selected = company;
    renderBody(); // refresh row highlight
    renderDrilldown(company);
    $("#drilldown").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function closeDrilldown() {
    state.selected = null;
    $("#drilldown").hidden = true;
    renderBody();
  }

  function onRowActivate(e) {
    const tr = e.target.closest("tr.vendor-row");
    if (!tr) return;
    if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
    if (e.type === "keydown") e.preventDefault();
    const company = tr.dataset.company;
    if (company === state.selected) closeDrilldown();
    else selectVendor(company);
  }

  function render() {
    renderSummary();
    renderHead();
    renderBody();
    $("#leaderboard").hidden = false;
  }

  function onHeadClick(e) {
    const th = e.target.closest("th.sortable");
    if (!th) return;
    const key = th.dataset.key;
    if (state.sortKey === key) {
      state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
    } else {
      state.sortKey = key;
      // Sensible default direction: text ascending, numbers/RAG descending.
      const col = COLUMNS.find((c) => c.key === key);
      state.sortDir = col && col.type === "text" ? "asc" : "desc";
    }
    render();
  }

  async function main() {
    const status = $("#status");
    try {
      const { registers, vendors } = await loadWorkbook();
      state.registers = registers;
      state.scores = Scoring.computeScores(vendors, registers);
      $("#leaderboard thead").addEventListener("click", onHeadClick);
      const tbody = $("#leaderboard tbody");
      tbody.addEventListener("click", onRowActivate);
      tbody.addEventListener("keydown", onRowActivate);
      render();
      status.hidden = true;
    } catch (err) {
      status.textContent = "Error: " + err.message;
      status.classList.add("error");
      console.error(err);
    }
  }

  document.addEventListener("DOMContentLoaded", main);
})();
