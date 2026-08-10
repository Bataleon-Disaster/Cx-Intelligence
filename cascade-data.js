/* ============================================================================
   DEPENDENCY CASCADE — programme model (synthetic)
   DH-02 · LHR095 L0 hall. This is the ONE place the programme lives.

   nodes: id, label, sys, level, start [y,m,d] (UTC, planned start), dur (days)
     sys:   ELEC | MECH | CTRL | NET | IST | MILE
     level: L2 (dead test) | L3 (live test) | L4 (integrated) | L5 (IST) |
            H2C | PFHO
   edges: [from, to, lagDays?]  — finish-to-start dependencies.
     A successor starts at max(its planned start, every pred finish + lag),
     so the gap between a pred's planned finish and the successor's planned
     start is that edge's FREE FLOAT. The H2C → PFHO edge carries an 11-day
     lag (punch-clear window) and zero float, so H2C and PFHO move together.

   All dates and durations are ILLUSTRATIVE — CONFIRM AGAINST THE PROGRAMME.
============================================================================ */
window.CASCADE_DATA = {
  meta: {
    programme: "DH-02",
    site: "LHR095 · L0 hall",
    costPerDay: 185000,       // £/day cost of delay on a 60MW facility
    sliderMax: 30             // what-if slip range, days
  },

  nodes: [
    // ---- L2 · dead tests -------------------------------------------------
    { id:"SDB_01A1", label:"SDB 01A1",  name:"LV switchboard A",      sys:"ELEC", level:"L2", start:[2026, 8, 3], dur:4 },
    { id:"SDB_01B2", label:"SDB 01B2",  name:"LV switchboard B",      sys:"ELEC", level:"L2", start:[2026, 8, 5], dur:4 },
    { id:"ACCEL_09", label:"ACCEL 09",  name:"Standby generator",     sys:"ELEC", level:"L2", start:[2026, 8,10], dur:3 },
    { id:"NET_CORE", label:"NET-CORE",  name:"OT network fabric",     sys:"NET",  level:"L2", start:[2026, 8, 3], dur:5 },

    // ---- L3 · live tests -------------------------------------------------
    { id:"UPS_C_A",  label:"UPS-C A",   name:"UPS string A",          sys:"ELEC", level:"L3", start:[2026, 8,24], dur:4 },
    { id:"UPS_C_B",  label:"UPS-C B",   name:"UPS string B",          sys:"ELEC", level:"L3", start:[2026, 8,28], dur:4 },
    { id:"CH_1",     label:"CH-1",      name:"Chiller 1",             sys:"MECH", level:"L3", start:[2026, 8,24], dur:5 },
    { id:"CH_2",     label:"CH-2",      name:"Chiller 2",             sys:"MECH", level:"L3", start:[2026, 8,26], dur:5 },
    { id:"CRAH_1",   label:"CRAH-1",    name:"Hall cooling unit 1",   sys:"MECH", level:"L3", start:[2026, 8,31], dur:3 },
    { id:"CRAH_2",   label:"CRAH-2",    name:"Hall cooling unit 2",   sys:"MECH", level:"L3", start:[2026, 9, 1], dur:3 },
    { id:"CRAH_3",   label:"CRAH-3",    name:"Hall cooling unit 3",   sys:"MECH", level:"L3", start:[2026, 9, 2], dur:3 },
    { id:"CRAH_4",   label:"CRAH-4",    name:"Hall cooling unit 4",   sys:"MECH", level:"L3", start:[2026, 9, 3], dur:3 },
    { id:"BMS_01",   label:"BMS-01",    name:"Building management",   sys:"CTRL", level:"L3", start:[2026, 8,31], dur:6 },
    { id:"EPMS_01",  label:"EPMS-01",   name:"Power monitoring",      sys:"CTRL", level:"L3", start:[2026, 9, 1], dur:5 },

    // ---- L4 · integrated systems ----------------------------------------
    { id:"ELEC_L4",  label:"ELEC L4",   name:"Integrated power · black-building", sys:"ELEC", level:"L4", start:[2026, 9, 8], dur:6 },
    { id:"MECH_L4",  label:"MECH L4",   name:"Integrated cooling · thermal run",   sys:"MECH", level:"L4", start:[2026, 9,14], dur:7 },
    { id:"CTRL_L4",  label:"CTRL L4",   name:"Cause & effect · C&E",               sys:"CTRL", level:"L4", start:[2026, 9,18], dur:5 },

    // ---- L5 · IST --------------------------------------------------------
    { id:"IST_L5",   label:"IST",       name:"L5 integrated systems test · 72h heat load", sys:"IST", level:"L5", start:[2026, 9,30], dur:14 },

    // ---- milestones ------------------------------------------------------
    { id:"H2C",      label:"H2C",       name:"Ready-for-handover milestone", sys:"MILE", level:"H2C",  start:[2026,10,19], dur:0 },
    { id:"PFHO",     label:"PFHO",      name:"Practical facility handover",  sys:"MILE", level:"PFHO", start:[2026,10,30], dur:0 }
  ],

  edges: [
    // L2 → L3 : live tests need their boards dead-tested first
    ["SDB_01A1","UPS_C_A"], ["ACCEL_09","UPS_C_A"],
    ["SDB_01B2","UPS_C_B"], ["ACCEL_09","UPS_C_B"],
    ["SDB_01A1","CH_1"],    ["SDB_01B2","CH_2"],
    ["SDB_01A1","CRAH_1"],  ["CH_1","CRAH_1"],
    ["SDB_01B2","CRAH_2"],  ["CH_1","CRAH_2"],
    ["SDB_01A1","CRAH_3"],  ["CH_2","CRAH_3"],
    ["SDB_01B2","CRAH_4"],  ["CH_2","CRAH_4"],
    ["NET_CORE","BMS_01"],  ["NET_CORE","EPMS_01"],

    // L3 → L4 : integrated tests need every feeding asset live
    ["UPS_C_A","ELEC_L4"], ["UPS_C_B","ELEC_L4"], ["EPMS_01","ELEC_L4"],
    ["CH_1","MECH_L4"], ["CH_2","MECH_L4"],
    ["CRAH_1","MECH_L4"], ["CRAH_2","MECH_L4"], ["CRAH_3","MECH_L4"], ["CRAH_4","MECH_L4"],
    ["BMS_01","MECH_L4"],
    ["ELEC_L4","MECH_L4"],            // thermal run needs proven power — ZERO float edge
    ["BMS_01","CTRL_L4"], ["EPMS_01","CTRL_L4"], ["ELEC_L4","CTRL_L4"],

    // L4 → L5 → handover
    ["ELEC_L4","IST_L5"], ["MECH_L4","IST_L5"], ["CTRL_L4","IST_L5"],
    ["IST_L5","H2C"],
    ["H2C","PFHO", 11]                // punch-clear window; H2C and PFHO move together
  ]
};
