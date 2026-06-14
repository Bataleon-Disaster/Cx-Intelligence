# Handover Brief — Vendor Accountability Leaderboard

**For:** Claude Code · **From:** Toby · **Build #1 (learning project)**
**Data:** `Vendor_Leaderboard_SAMPLE.xlsx` (synthetic — invented vendors and numbers, safe to use)

---

## 1. What we're building

An **interactive vendor accountability leaderboard** — a single-page dashboard that reads the attached spreadsheet, scores each vendor on their open and overdue items across four registers, ranks them worst-to-best, and shows it clearly with RAG status. The question it answers: *"who is holding the programme back?"*

This is a learning build, not a production product. The priority is a clean, working result I can run locally and understand — not polish or scale.

## 2. The data

The sample workbook has six sheets. Four are source registers; one is the target output; one is reference values.

| Sheet | Role | Key columns |
|---|---|---|
| `Observations` | source | Obs ID, **Company**, System, Status, Priority, Days Overdue |
| `Punch_List` | source | Punch ID, **Company**, System, Status, Priority, Days Overdue |
| `Actions` | source | Action ID, **Company**, Type, Status, Priority, Days Overdue |
| `QAQC_Items` | source | Item ID, **Company**, System, Stage, Status, Days Overdue |
| `Vendor_Scorecard` | **target output** | the aggregated leaderboard (already computed with formulas — use it to check your maths) |
| `Lookups` | reference | valid Status / Priority / RAG / System values + the vendor list |

Every record is owned by a **Company** (column B in each register). That's the field you aggregate on.

## 3. The logic (compute this per company)

For each vendor, count across the four registers:

- **Open Obs / Punch / Actions** = records for that company whose status is *not* a closed state.
  - Obs & Punch closed states: `Closed`, `Void`. Punch also has `Ready for Inspection` (still open).
  - Actions closed states: `Complete`, `Cancelled`.
- **Overdue Obs / Punch / Actions / QAQC** = records for that company where **Days Overdue > 0**.
- **Total Open** = Open Obs + Open Punch + Open Actions.
- **Total Overdue** = Overdue Obs + Overdue Punch + Overdue Actions + Overdue QAQC.
- **RAG** (from Total Overdue): `GREEN` = 0, `AMBER` = 1–3, `RED` = 4+.
- **Rank**: sort by **Total Overdue** descending (highest = worst = top of the board).

The `Vendor_Scorecard` sheet already implements all of this in Excel formulas — your computed numbers should match it exactly. Treat it as the acceptance test for your aggregation.

## 4. Build requirements

- Reads the `.xlsx` directly (don't make me paste data in).
- A ranked leaderboard table: Company, Total Overdue, Total Open, RAG, and the breakdown columns.
- **Sortable** columns; default sort = Total Overdue, descending.
- RAG shown as colour (red / amber / green), not just text.
- A **summary panel** at the top: number of vendors, count in RED, total overdue items across the programme.
- **Drill-down**: clicking a vendor reveals their individual open/overdue records from the registers.
- Runs locally with one command, in the browser.

Keep the stack simple and self-contained — your call on the framework, but justify it in the plan. Static/local is fine; no backend, no database, no login.

## 5. How I want you to work (I'm learning, so narrate)

1. **Plan first.** Before writing any code, lay out your approach — stack choice, file structure, how you'll parse the sheets, how you'll compute the scores — and wait for me to approve it. Use plan mode.
2. **Narrate as you go.** Briefly explain each step and why, so this doubles as a walkthrough of how you work.
3. **Build incrementally** — get data parsing + the ranked table working first, then RAG colours, then the summary panel, then drill-down. Show me a runnable result at each stage.
4. **Synthetic data only.** Everything here is invented. Do not ask me for, or attempt to use, real programme data.
5. At the end, give me the one command to run it and a two-line note on how it's structured.

## 6. Definition of done

- [ ] Loads `Vendor_Leaderboard_SAMPLE.xlsx` and computes per-vendor scores that **match the `Vendor_Scorecard` sheet**.
- [ ] Ranked, sortable leaderboard with RAG colours.
- [ ] Working summary panel.
- [ ] Click a vendor → see their underlying items.
- [ ] Runs locally with a single documented command.

## 7. Kickoff prompt (paste this into Claude Code)

> I want to build an interactive vendor accountability leaderboard from the attached spreadsheet `Vendor_Leaderboard_SAMPLE.xlsx`. The full spec is in `Handover_Brief.md` in this folder — read it first.
>
> The outcome I want: a local, browser-based dashboard that reads the four register sheets, scores each vendor on open and overdue items, ranks them by Total Overdue, shows RAG status in colour, has a summary panel, and lets me click a vendor to see their items. My computed numbers must match the `Vendor_Scorecard` sheet.
>
> Before writing any code, plan your approach and the file structure and let me approve it. Then build it incrementally, explaining each step as you go — I'm learning how you work. The data is synthetic; don't ask for real data.

## 8. Once it works (stretch experiments)

- Add a **trend** arrow per vendor (needs a second data snapshot — I can generate one).
- Add a **weekly status export** button (PDF/PNG of the board for coordination meetings).
- Swap the sample file for a freshly de-identified extract of the real tracker, same column names — the dashboard shouldn't care.
- Point Fable 5 at the harder version and let it run.

---

*Note: this brief and its data are fully synthetic. When you eventually move to real data, de-identify first and confirm any data-handling rules for the programme.*
