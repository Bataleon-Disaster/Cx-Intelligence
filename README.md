# Vendor Accountability Leaderboard

An interactive, local dashboard that reads `Vendor_Leaderboard_SAMPLE.xlsx`, scores
each vendor on open and overdue items across the four registers, ranks them
worst-to-best by **Total Overdue**, and shows RAG status in colour. It answers:
*"who is holding the programme back?"*

All data is synthetic.

## Run it

```bash
python3 serve.py
```

Then open **http://localhost:8000** (the script also tries to open it for you).
A static file server is needed only so the browser can `fetch` the `.xlsx` over
http — there is no backend, database, or build step.

## Check the maths

```bash
node verify.cjs
```

This runs the **same** scoring logic the dashboard uses and asserts every value
matches the `Vendor_Scorecard` sheet (the acceptance test). All 10 vendors pass.

## How it's structured

- **`scoring.js`** is the single, pure source of truth for the maths (open/overdue
  rules, totals, RAG, ranking, drill-down) — shared by the browser (`app.js`) and
  the Node test (`verify.cjs`), so the numbers you see are the numbers we test.
- **`index.html` + `app.js` + `styles.css`** load the `.xlsx` in-browser with the
  vendored SheetJS (`vendor/xlsx.full.min.js`) and render the summary panel, the
  sortable RAG leaderboard, and the click-to-expand vendor drill-down.

## Scoring rules (mirrors the Vendor_Scorecard formulas)

- **Open Obs / Punch** = company rows excluding status `Closed` / `Void`
  (so `Ready for Inspection` and `In Progress` stay *open*).
- **Open Actions** = excluding `Complete` / `Cancelled`.
- **Overdue (per register)** = rows where `Days Overdue > 0`.
- **Total Open** = Open Obs + Punch + Actions. **Total Overdue** = the four overdue counts.
- **RAG** = `RED` if Total Overdue ≥ 4, `AMBER` if 1–3, `GREEN` if 0.
- **Rank** = Total Overdue descending (tie-break: Total Open desc, then name).
