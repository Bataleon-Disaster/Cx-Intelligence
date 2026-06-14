#!/usr/bin/env node
/*
 * verify.cjs — acceptance test.
 *
 * Loads Vendor_Leaderboard_SAMPLE.xlsx, runs the SHARED scoring.js logic over
 * the four registers, and asserts the result matches the Vendor_Scorecard sheet
 * cell-for-cell. Exits non-zero on any mismatch so it can gate the build.
 *
 *   node verify.cjs
 */
const fs = require("fs");
const path = require("path");
const XLSX = require("./vendor/xlsx.full.min.js");
const Scoring = require("./scoring.js");

const FILE = path.join(__dirname, "Vendor_Leaderboard_SAMPLE.xlsx");

// Map a computed score object -> the Vendor_Scorecard column layout.
const COLUMNS = [
  ["Open Obs", "openObs"],
  ["Open Punch", "openPunch"],
  ["Open Actions", "openActions"],
  ["Overdue Obs", "overdueObs"],
  ["Overdue Punch", "overduePunch"],
  ["Overdue Actions", "overdueActions"],
  ["Overdue QAQC/Cx", "overdueQAQC"],
  ["Total Open", "totalOpen"],
  ["Total Overdue", "totalOverdue"],
  ["RAG", "rag"],
];

function load() {
  // The standalone SheetJS build doesn't auto-wire Node's fs, so read bytes
  // ourselves and parse from the buffer (mirrors how the browser uses XLSX.read).
  const wb = XLSX.read(fs.readFileSync(FILE), { type: "buffer" });
  const sheet = (name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null });

  const registers = {
    obs: sheet("Observations"),
    punch: sheet("Punch_List"),
    actions: sheet("Actions"),
    qaqc: sheet("QAQC_Items"),
  };

  // Vendor list = the Company column of Lookups (so zero-item vendors appear too).
  const vendors = sheet("Lookups")
    .map((r) => r.Company)
    .filter((v) => v != null && String(v).trim() !== "");

  // Expected leaderboard, keyed by company.
  const expected = {};
  for (const row of sheet("Vendor_Scorecard")) {
    if (row.Company == null) continue;
    expected[String(row.Company).trim()] = row;
  }

  return { registers, vendors, expected };
}

function main() {
  const { registers, vendors, expected } = load();
  const scores = Scoring.computeScores(vendors, registers);

  let failures = 0;
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad("Company", 20) + "Result");
  console.log("-".repeat(60));

  for (const s of scores) {
    const exp = expected[String(s.company).trim()];
    const problems = [];
    if (!exp) {
      problems.push("not found in Vendor_Scorecard");
    } else {
      for (const [col, key] of COLUMNS) {
        const got = s[key];
        const want = exp[col];
        // numbers compared numerically, RAG as string
        const same = key === "rag" ? String(got) === String(want) : Number(got) === Number(want);
        if (!same) problems.push(`${col}: got ${got}, want ${want}`);
      }
    }
    if (problems.length) {
      failures++;
      console.log(pad(s.company, 20) + "FAIL  " + problems.join("; "));
    } else {
      console.log(pad(s.company, 20) + "ok");
    }
  }

  console.log("-".repeat(60));
  if (failures === 0) {
    console.log(`PASS: all ${scores.length} vendors match Vendor_Scorecard exactly.`);
    process.exit(0);
  } else {
    console.log(`FAIL: ${failures} vendor(s) did not match Vendor_Scorecard.`);
    process.exit(1);
  }
}

main();
