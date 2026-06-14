/*
 * scoring.js — pure vendor-scoring logic.
 *
 * This module has NO I/O and NO Excel dependency. It takes already-parsed
 * plain-object rows and returns the leaderboard. Because it is pure, the
 * EXACT same code runs in the browser (app.js) and in the Node acceptance
 * test (verify.cjs), so the numbers you see are the numbers we test.
 *
 * The logic mirrors the COUNTIF/COUNTIFS formulas in the Vendor_Scorecard
 * sheet, which is our acceptance test:
 *   - Open Obs/Punch   = rows for the company, excluding Status Closed/Void
 *     (so "Ready for Inspection" and "In Progress" still count as OPEN).
 *   - Open Actions     = rows for the company, excluding Status Complete/Cancelled.
 *   - Overdue <reg>    = rows for the company where Days Overdue > 0.
 *   - Total Open       = Open Obs + Open Punch + Open Actions.
 *   - Total Overdue    = Overdue Obs + Punch + Actions + QAQC.
 *   - RAG              = RED if Total Overdue >= 4, AMBER if 1..3, else GREEN.
 *   - Rank             = Total Overdue desc (tie-break: Total Open desc, then name).
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();          // Node / CommonJS
  } else {
    root.Scoring = factory();            // Browser global: window.Scoring
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Status values that mean an item is CLOSED (i.e. not open), per register.
  const CLOSED_STATUS = {
    obs: ["Closed", "Void"],
    punch: ["Closed", "Void"],
    actions: ["Complete", "Cancelled"],
  };

  const clean = (v) => (v == null ? "" : String(v).trim());

  // Excel's ">0" criterion: numeric and strictly greater than zero.
  function isOverdue(daysOverdue) {
    const n = Number(daysOverdue);
    return Number.isFinite(n) && n > 0;
  }

  function isOpen(register, status) {
    const closed = CLOSED_STATUS[register] || [];
    return !closed.includes(clean(status));
  }

  function ragOf(totalOverdue) {
    if (totalOverdue >= 4) return "RED";
    if (totalOverdue >= 1) return "AMBER";
    return "GREEN";
  }

  // registers: { obs:[...], punch:[...], actions:[...], qaqc:[...] }
  // Each row is a plain object keyed by the sheet's column headers, and must
  // expose "Company", "Status" and "Days Overdue".
  function scoreVendor(company, registers) {
    const c = clean(company);
    const forCo = (rows) => rows.filter((r) => clean(r.Company) === c);

    const obs = forCo(registers.obs);
    const punch = forCo(registers.punch);
    const actions = forCo(registers.actions);
    const qaqc = forCo(registers.qaqc);

    const openObs = obs.filter((r) => isOpen("obs", r.Status)).length;
    const openPunch = punch.filter((r) => isOpen("punch", r.Status)).length;
    const openActions = actions.filter((r) => isOpen("actions", r.Status)).length;

    const overdueObs = obs.filter((r) => isOverdue(r["Days Overdue"])).length;
    const overduePunch = punch.filter((r) => isOverdue(r["Days Overdue"])).length;
    const overdueActions = actions.filter((r) => isOverdue(r["Days Overdue"])).length;
    const overdueQAQC = qaqc.filter((r) => isOverdue(r["Days Overdue"])).length;

    const totalOpen = openObs + openPunch + openActions;
    const totalOverdue = overdueObs + overduePunch + overdueActions + overdueQAQC;

    return {
      company,
      openObs,
      openPunch,
      openActions,
      overdueObs,
      overduePunch,
      overdueActions,
      overdueQAQC,
      totalOpen,
      totalOverdue,
      rag: ragOf(totalOverdue),
    };
  }

  function computeScores(vendors, registers) {
    return vendors.map((v) => scoreVendor(v, registers));
  }

  // Per-register metadata for the drill-down: which columns to read and label.
  // `openKey` is the register key for isOpen(); null means the register has no
  // "open" concept in the scorecard (QAQC is overdue-only).
  const REGISTER_META = {
    obs: { label: "Observation", idField: "Obs ID", catField: "System", openKey: "obs" },
    punch: { label: "Punch", idField: "Punch ID", catField: "System", openKey: "punch" },
    actions: { label: "Action", idField: "Action ID", catField: "Type", openKey: "actions" },
    qaqc: { label: "QA/QC", idField: "Item ID", catField: "System", openKey: null },
  };

  // Records behind a vendor's score: every item that counts toward a displayed
  // column (open Obs/Punch/Actions, or overdue in any register).
  function vendorItems(company, registers) {
    const c = clean(company);
    const items = [];
    for (const regKey of Object.keys(REGISTER_META)) {
      const meta = REGISTER_META[regKey];
      for (const r of registers[regKey]) {
        if (clean(r.Company) !== c) continue;
        const open = meta.openKey ? isOpen(meta.openKey, r.Status) : false;
        const overdue = isOverdue(r["Days Overdue"]);
        if (!open && !overdue) continue; // not behind any counted column
        items.push({
          register: meta.label,
          id: r[meta.idField],
          category: clean(r[meta.catField]),
          stage: clean(r.Stage), // QAQC only; "" elsewhere
          status: clean(r.Status),
          priority: clean(r.Priority), // "" for QAQC
          dueDate: clean(r["Due Date"]),
          daysOverdue: Number(r["Days Overdue"]) || 0,
          open,
          overdue,
        });
      }
    }
    // Overdue first (most overdue at top), then the rest.
    items.sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      return b.daysOverdue - a.daysOverdue;
    });
    return items;
  }

  // Default ranking: worst (most overdue) first.
  function rankScores(scores) {
    return scores.slice().sort((a, b) => {
      if (b.totalOverdue !== a.totalOverdue) return b.totalOverdue - a.totalOverdue;
      if (b.totalOpen !== a.totalOpen) return b.totalOpen - a.totalOpen;
      return clean(a.company).localeCompare(clean(b.company));
    });
  }

  function summarize(scores) {
    return {
      vendorCount: scores.length,
      redCount: scores.filter((s) => s.rag === "RED").length,
      totalOverdue: scores.reduce((sum, s) => sum + s.totalOverdue, 0),
      totalOpen: scores.reduce((sum, s) => sum + s.totalOpen, 0),
    };
  }

  return {
    CLOSED_STATUS,
    isOverdue,
    isOpen,
    ragOf,
    scoreVendor,
    computeScores,
    rankScores,
    summarize,
    vendorItems,
  };
});
