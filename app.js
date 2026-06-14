/*
 * app.js — browser side of the leaderboard.
 *
 * Flow: fetch the .xlsx -> parse with SheetJS -> normalize the four registers
 * and the vendor list -> run the SHARED scoring.js -> render the ranked table.
 * (RAG colours, sorting, summary panel and drill-down are layered on later.)
 */
(function () {
  "use strict";

  const DATA_FILE = "Vendor_Leaderboard_SAMPLE.xlsx";

  // Columns shown in the leaderboard. `key` maps to a field on a score object.
  const COLUMNS = [
    { key: "rank", label: "#" },
    { key: "company", label: "Company" },
    { key: "totalOverdue", label: "Total Overdue" },
    { key: "totalOpen", label: "Total Open" },
    { key: "openObs", label: "Open Obs" },
    { key: "openPunch", label: "Open Punch" },
    { key: "openActions", label: "Open Actions" },
    { key: "overdueObs", label: "Overdue Obs" },
    { key: "overduePunch", label: "Overdue Punch" },
    { key: "overdueActions", label: "Overdue Actions" },
    { key: "overdueQAQC", label: "Overdue QAQC" },
    { key: "rag", label: "RAG" },
  ];

  const $ = (sel) => document.querySelector(sel);

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

  function renderTable(rankedScores) {
    const table = $("#leaderboard");
    const thead = table.querySelector("thead");
    const tbody = table.querySelector("tbody");

    thead.innerHTML =
      "<tr>" + COLUMNS.map((c) => `<th>${c.label}</th>`).join("") + "</tr>";

    tbody.innerHTML = rankedScores
      .map((s, i) => {
        const row = { ...s, rank: i + 1 };
        const cells = COLUMNS.map((c) => `<td>${row[c.key]}</td>`).join("");
        return `<tr>${cells}</tr>`;
      })
      .join("");

    table.hidden = false;
  }

  async function main() {
    const status = $("#status");
    try {
      const { registers, vendors } = await loadWorkbook();
      const scores = Scoring.computeScores(vendors, registers);
      const ranked = Scoring.rankScores(scores);
      renderTable(ranked);
      status.hidden = true;
    } catch (err) {
      status.textContent = "Error: " + err.message;
      status.classList.add("error");
      console.error(err);
    }
  }

  document.addEventListener("DOMContentLoaded", main);
})();
