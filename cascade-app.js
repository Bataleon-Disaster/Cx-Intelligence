"use strict";
/* ============================================================================
   DEPENDENCY CASCADE
   A commissioning programme as a dependency DAG → CPM forward pass under
   what-if slips → float consumption → handover movement → cost of delay.

   Engine first (pure, DOM-free — window.CascadeEngine, unit-testable),
   UI below (only runs when the page provides #diagram).

   Model:
   - Finish-to-start edges with optional lag. A node starts at
     max(planned start, every pred finish + lag) and finishes after
     dur + slip days. The gap between a pred's planned finish and a
     successor's planned start is that edge's free float.
   - Slips extend a node's completion; the forward pass propagates them.
   - The backward pass (latest finishes against the baseline PFHO date)
     gives each asset its remaining headroom: how many more days it can
     slip before handover itself moves.
============================================================================ */

/* ================================ ENGINE ================================ */
(function () {
  var MS = 86400000;
  function U(a) { return Date.UTC(a[0], a[1] - 1, a[2]); }

  // ---- index + topological order (Kahn) — throws on a dependency cycle
  function buildModel(data) {
    var byId = new Map();
    data.nodes.forEach(function (n) { byId.set(n.id, n); });
    var preds = new Map(), succs = new Map();
    data.nodes.forEach(function (n) { preds.set(n.id, []); succs.set(n.id, []); });
    data.edges.forEach(function (e) {
      var from = e[0], to = e[1], lag = e[2] || 0;
      if (!byId.has(from) || !byId.has(to)) throw new Error("Edge references unknown node: " + from + " → " + to);
      preds.get(to).push({ id: from, lag: lag });
      succs.get(from).push({ id: to, lag: lag });
    });
    var indeg = new Map(), q = [], order = [];
    data.nodes.forEach(function (n) {
      indeg.set(n.id, preds.get(n.id).length);
      if (!preds.get(n.id).length) q.push(n.id);
    });
    while (q.length) {
      var id = q.shift();
      order.push(id);
      succs.get(id).forEach(function (s) {
        indeg.set(s.id, indeg.get(s.id) - 1);
        if (indeg.get(s.id) === 0) q.push(s.id);
      });
    }
    if (order.length !== data.nodes.length) throw new Error("Dependency cycle detected — the programme graph must be a DAG.");
    return { data: data, byId: byId, preds: preds, succs: succs, order: order };
  }

  // ---- forward pass: earliest start/finish under a slip scenario {id: days}
  function forwardPass(model, slips) {
    slips = slips || {};
    var out = new Map();
    model.order.forEach(function (id) {
      var n = model.byId.get(id);
      var fs = U(n.start);
      model.preds.get(id).forEach(function (p) {
        var arrive = out.get(p.id).ff + p.lag * MS;
        if (arrive > fs) fs = arrive;
      });
      var ff = fs + (n.dur + (slips[id] || 0)) * MS;
      out.set(id, { fs: fs, ff: ff });
    });
    return out;
  }

  // ---- backward pass: latest finish for each node such that the sink
  //      (PFHO) still lands on targetFF. headroom = lf − ff.
  function latestFinish(model, fwd, slips, sinkId, targetFF) {
    slips = slips || {};
    var lf = new Map();
    for (var i = model.order.length - 1; i >= 0; i--) {
      var id = model.order[i];
      var v = (id === sinkId) ? targetFF : Infinity;
      model.succs.get(id).forEach(function (s) {
        var sn = model.byId.get(s.id);
        var latestStartOfSucc = lf.get(s.id) - (sn.dur + (slips[s.id] || 0)) * MS;
        var bound = latestStartOfSucc - s.lag * MS;
        if (bound < v) v = bound;
      });
      lf.set(id, v);
    }
    return lf;
  }

  function headroomDays(model, fwd, lf, id) {
    var v = lf.get(id);
    if (v === Infinity) return Infinity;             // node feeds nothing
    return Math.floor((v - fwd.get(id).ff) / MS);
  }

  // ---- driving chain: from the sink, follow whichever predecessor's
  //      arrival actually set each start. Stops where a node is held by its
  //      planned date rather than by a predecessor.
  function driverChain(model, fwd, sinkId) {
    var nodes = [sinkId], edges = [];
    var cur = sinkId, guard = 0;
    while (guard++ < 1000) {
      var f = fwd.get(cur), best = null, bestArrive = -Infinity;
      model.preds.get(cur).forEach(function (p) {
        var arrive = fwd.get(p.id).ff + p.lag * MS;
        if (arrive > bestArrive) { bestArrive = arrive; best = p.id; }
      });
      if (best === null || bestArrive < f.fs) break;  // date-held, not pred-held
      edges.push(best + ">" + cur);
      nodes.push(best);
      cur = best;
    }
    return { nodes: nodes, edges: edges };
  }

  window.CascadeEngine = {
    MS: MS, U: U,
    buildModel: buildModel,
    forwardPass: forwardPass,
    latestFinish: latestFinish,
    headroomDays: headroomDays,
    driverChain: driverChain
  };
})();

/* ================================== UI ================================== */
(function () {
  if (typeof document === "undefined" || !document.getElementById("diagram")) return;

  var E = window.CascadeEngine, MS = E.MS;
  var DATA = window.CASCADE_DATA;
  var model = E.buildModel(DATA);
  var base = E.forwardPass(model, {});
  var basePfho = base.get("PFHO").ff;

  // seed self-check: the planned dates must already satisfy the graph
  model.data.edges.forEach(function (e) {
    var slack = E.U(model.byId.get(e[1]).start) - (base.get(e[0]).ff + (e[2] || 0) * MS);
    if (slack < 0) console.warn("Seed schedule inconsistent on edge " + e[0] + " → " + e[1] +
      " (planned start " + (-slack / MS) + "d before its dependency clears)");
  });

  var slips = {};            // id → days
  var selected = null;       // id being driven by the slider

  var LEVELS = ["L2", "L3", "L4", "L5", "H2C", "PFHO"];
  var LEVEL_LAB = { L2: "L2 · dead test", L3: "L3 · live test", L4: "L4 · integrated", L5: "L5 · IST", H2C: "H2C", PFHO: "PFHO" };
  var SYS_ORDER = ["ELEC", "MECH", "CTRL", "NET", "IST", "MILE"];
  var SYS_COLOR = { ELEC: "#f7c948", MECH: "#3b82f6", CTRL: "#a78bfa", NET: "#22d3ee", IST: "#34d399", MILE: "#94a3b8" };
  var SYS_LAB = { ELEC: "Electrical", MECH: "Mechanical", CTRL: "Controls", NET: "Network", IST: "IST", MILE: "Milestone" };

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmt(ms) {
    var d = new Date(ms);
    return String(d.getUTCDate()).padStart(2, "0") + " " + MONTHS[d.getUTCMonth()] + " " + String(d.getUTCFullYear()).slice(2);
  }
  function currency(n) {
    if (n >= 1e6) return "£" + (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + "m";
    if (n >= 1e3) return "£" + Math.round(n / 1e3) + "k";
    return "£" + n;
  }
  function el(tag, cls, html) {
    var x = document.createElement(tag);
    if (cls) x.className = cls;
    if (html !== undefined) x.innerHTML = html;
    return x;
  }
  function slippable(n) { return n.sys !== "MILE"; }

  /* ---------------- layout (fixed columns by level) ---------------- */
  var BOXW = 176, BOXH = 58, COLGAP = 96, ROWGAP = 13, MARGIN = 42, HEADR = 30;
  var cols = LEVELS.map(function (lv) {
    var ns = DATA.nodes.filter(function (n) { return n.level === lv; });
    ns.sort(function (a, b) {
      var d = SYS_ORDER.indexOf(a.sys) - SYS_ORDER.indexOf(b.sys);
      return d !== 0 ? d : a.id.localeCompare(b.id);
    });
    return ns;
  });
  var maxRows = Math.max.apply(null, cols.map(function (c) { return c.length; }));
  var innerH = maxRows * BOXH + (maxRows - 1) * ROWGAP;
  var svgW = MARGIN * 2 + LEVELS.length * BOXW + (LEVELS.length - 1) * COLGAP;
  var svgH = MARGIN * 2 + HEADR + innerH;
  var pos = new Map();
  cols.forEach(function (ns, ci) {
    var colH = ns.length * BOXH + (ns.length - 1) * ROWGAP;
    var y0 = MARGIN + HEADR + (innerH - colH) / 2;
    ns.forEach(function (n, ri) {
      pos.set(n.id, { x: MARGIN + ci * (BOXW + COLGAP), y: y0 + ri * (BOXH + ROWGAP) });
    });
  });

  var svg = document.getElementById("diagram");
  var NS = "http://www.w3.org/2000/svg";
  svg.setAttribute("viewBox", "0 0 " + svgW + " " + svgH);
  function S(tag, attrs, parent) {
    var x = document.createElementNS(NS, tag);
    for (var k in attrs) x.setAttribute(k, attrs[k]);
    (parent || svg).appendChild(x);
    return x;
  }

  /* ---------------- controls ---------------- */
  var srcSel = document.getElementById("srcSel");
  var slider = document.getElementById("slip");
  var slipVal = document.getElementById("slipVal");
  slider.max = DATA.meta.sliderMax;

  var og = {};
  SYS_ORDER.forEach(function (s) {
    if (s === "MILE") return;
    og[s] = document.createElement("optgroup");
    og[s].setAttribute("label", SYS_LAB[s]);
  });
  DATA.nodes.filter(slippable).forEach(function (n) {
    var o = document.createElement("option");
    o.value = n.id;
    o.textContent = n.label + " · " + n.name;
    og[n.sys].appendChild(o);
  });
  SYS_ORDER.forEach(function (s) { if (og[s] && og[s].children.length) srcSel.appendChild(og[s]); });

  function select(id) {
    selected = id;
    if (id) srcSel.value = id;
    slider.value = (id && slips[id]) || 0;
    render();
  }
  srcSel.addEventListener("change", function () { select(srcSel.value); });
  slider.addEventListener("input", function () {
    if (!selected) selected = srcSel.value;
    var v = parseInt(slider.value, 10);
    if (v > 0) slips[selected] = v; else delete slips[selected];
    render();
  });
  document.getElementById("btnReset").addEventListener("click", function () {
    slips = {}; slider.value = 0; render();
  });

  /* ---------------- legend ---------------- */
  var legend = document.getElementById("legend");
  SYS_ORDER.forEach(function (s) {
    legend.appendChild(el("span", null, '<i style="background:' + SYS_COLOR[s] + '"></i>' + SYS_LAB[s]));
  });
  legend.appendChild(el("span", null, '<i style="background:transparent;border-color:var(--amber)"></i>Moves'));
  legend.appendChild(el("span", null, '<i style="background:transparent;border-color:var(--red)"></i>Driving handover'));

  /* ---------------- render ---------------- */
  function render() {
    var fwd = E.forwardPass(model, slips);
    var lf = E.latestFinish(model, fwd, slips, "PFHO", basePfho);
    var pfhoDelta = Math.round((fwd.get("PFHO").ff - basePfho) / MS);
    var h2cDelta = Math.round((fwd.get("H2C").ff - base.get("H2C").ff) / MS);
    var chain = pfhoDelta > 0 ? E.driverChain(model, fwd, "PFHO") : { nodes: [], edges: [] };
    var chainNodes = new Set(chain.nodes), chainEdges = new Set(chain.edges);
    var slipIds = Object.keys(slips);
    var moved = DATA.nodes.filter(function (n) {
      return fwd.get(n.id).ff > base.get(n.id).ff;
    });

    slipVal.textContent = (selected && slips[selected] ? slips[selected] : 0) + " days";

    /* ---- diagram ---- */
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    LEVELS.forEach(function (lv, ci) {
      var x = MARGIN + ci * (BOXW + COLGAP);
      S("text", { x: x + BOXW / 2, y: MARGIN + 6, "text-anchor": "middle", class: "colhead" }).textContent = LEVEL_LAB[lv];
    });

    DATA.edges.forEach(function (e) {
      var a = pos.get(e[0]), b = pos.get(e[1]);
      var x1 = a.x + BOXW, y1 = a.y + BOXH / 2, x2 = b.x, y2 = b.y + BOXH / 2;
      var mx = (x1 + x2) / 2;
      var onChain = chainEdges.has(e[0] + ">" + e[1]);
      var live = fwd.get(e[0]).ff > base.get(e[0]).ff;   // upstream of this edge moved
      var p = S("path", {
        d: "M" + x1 + " " + y1 + " C" + mx + " " + y1 + ", " + mx + " " + y2 + ", " + x2 + " " + y2,
        class: "edge" + (onChain ? " chain" : live ? " live" : "")
      });
      var ffree = Math.max(0, Math.round((E.U(model.byId.get(e[1]).start) - (base.get(e[0]).ff + (e[2] || 0) * MS)) / MS));
      S("title", {}, p).textContent = model.byId.get(e[0]).label + " → " + model.byId.get(e[1]).label +
        " · free float " + ffree + "d" + (e[2] ? " · lag " + e[2] + "d" : "");
    });

    DATA.nodes.forEach(function (n) {
      var pnt = pos.get(n.id), f = fwd.get(n.id);
      var delta = Math.round((f.ff - base.get(n.id).ff) / MS);
      var driving = chainNodes.has(n.id) && pfhoDelta > 0;
      var g = S("g", {
        class: "node" + (driving ? " breach" : delta > 0 ? " shift" : "") +
          (n.id === selected ? " sel" : "") + (slippable(n) ? " clickable" : "")
      });
      S("rect", { x: pnt.x, y: pnt.y, width: BOXW, height: BOXH, rx: 9 }, g);
      S("rect", { x: pnt.x, y: pnt.y + 6, width: 4, height: BOXH - 12, fill: SYS_COLOR[n.sys] }, g);
      var t1 = S("text", { x: pnt.x + 14, y: pnt.y + 18, class: "nlab" }, g);
      t1.textContent = n.label + (slips[n.id] ? "  ⚠ +" + slips[n.id] + "d slip" : "");
      var t2 = S("text", { x: pnt.x + 14, y: pnt.y + 33, class: "nname" }, g);
      t2.textContent = n.name.length > 26 ? n.name.slice(0, 25) + "…" : n.name;
      var t3 = S("text", { x: pnt.x + 14, y: pnt.y + 49, class: "ndate" }, g);
      t3.textContent = fmt(f.ff) + (delta > 0 ? "  ·  +" + delta + "d" : "");
      var hd = E.headroomDays(model, fwd, lf, n.id);
      S("title", {}, g).textContent = n.label + " · " + n.name +
        "\nPlan finish " + fmt(base.get(n.id).ff) + " → forecast " + fmt(f.ff) +
        (delta > 0 ? " (+" + delta + "d)" : "") +
        (hd !== Infinity ? "\nCan absorb " + Math.max(0, hd) + "d more before handover moves" : "");
      if (slippable(n)) g.addEventListener("click", function () { select(n.id); });
    });

    /* ---- outputs ---- */
    var floatEl = document.getElementById("oFloat");
    if (pfhoDelta > 0) {
      floatEl.innerHTML = '<span class="bad">0d · gone</span>';
    } else {
      var ref = selected || slipIds[0] || "IST_L5";
      var hdd = slipIds.length
        ? Math.min.apply(null, slipIds.map(function (id) { return E.headroomDays(model, fwd, lf, id); }))
        : E.headroomDays(model, fwd, lf, ref);
      floatEl.innerHTML = '<span class="good">' + Math.max(0, hdd) + "d</span>";
    }
    document.getElementById("oH2c").innerHTML = h2cDelta > 0
      ? '<span class="bad">+' + h2cDelta + "d</span>" : '<span class="good">on plan</span>';
    document.getElementById("oPfho").innerHTML = pfhoDelta > 0
      ? '<span class="bad">' + fmt(fwd.get("PFHO").ff) + "</span>" : fmt(basePfho);
    var cost = pfhoDelta * DATA.meta.costPerDay;
    document.getElementById("oCost").innerHTML = cost > 0
      ? '<span class="bad">' + currency(cost) + "</span>" : '<span class="dim">£0</span>';
    document.getElementById("oImpact").innerHTML = moved.length
      ? '<span class="' + (pfhoDelta > 0 ? "bad" : "warn") + '">' + moved.length + "</span>" : '<span class="dim">0</span>';

    var note = document.getElementById("note");
    if (!slipIds.length) {
      note.innerHTML = "Tap an asset in the diagram (or pick one above) and drag the slip. The cascade propagates through the " +
        "real dependency edges — free float absorbs first, then dates move, then handover moves.";
    } else if (pfhoDelta === 0) {
      var minhd = Math.min.apply(null, slipIds.map(function (id) { return E.headroomDays(model, fwd, lf, id); }));
      note.innerHTML = "Scenario absorbed — <b>" + moved.length + "</b> asset" + (moved.length === 1 ? "" : "s") +
        " move" + (moved.length === 1 ? "s" : "") + " but handover holds. <b>" + Math.max(0, minhd) +
        "d</b> of float left before it bites.";
    } else {
      note.innerHTML = "Float exhausted. PFHO moves <b>+" + pfhoDelta + "d</b> to <b>" + fmt(fwd.get("PFHO").ff) +
        "</b> — cost of delay <b>" + currency(cost) + "</b> at " + currency(DATA.meta.costPerDay) +
        "/day. The driving chain is highlighted in red.";
    }

    /* ---- scenario chips ---- */
    var chipsEl = document.getElementById("scenario");
    chipsEl.innerHTML = "";
    if (!slipIds.length) {
      chipsEl.appendChild(el("span", "empty", "No slips staged — baseline programme."));
    }
    slipIds.forEach(function (id) {
      var n = model.byId.get(id);
      var c = el("button", "slipchip", n.label + " +" + slips[id] + "d <b>×</b>");
      c.title = "Remove this slip";
      c.addEventListener("click", function () {
        delete slips[id];
        if (selected === id) slider.value = 0;
        render();
      });
      chipsEl.appendChild(c);
    });

    /* ---- impact table ---- */
    var tb = document.querySelector("#impact tbody");
    tb.innerHTML = "";
    var rows = DATA.nodes.slice().sort(function (a, b) {
      var da = fwd.get(a.id).ff - base.get(a.id).ff, db = fwd.get(b.id).ff - base.get(b.id).ff;
      if (db !== da) return db - da;
      var ha = E.headroomDays(model, fwd, lf, a.id), hb = E.headroomDays(model, fwd, lf, b.id);
      if (ha !== hb) return ha - hb;
      return base.get(a.id).ff - base.get(b.id).ff;
    });
    rows.forEach(function (n) {
      var f = fwd.get(n.id);
      var delta = Math.round((f.ff - base.get(n.id).ff) / MS);
      var hd = E.headroomDays(model, fwd, lf, n.id);
      var driving = chainNodes.has(n.id) && pfhoDelta > 0;
      var status = driving ? '<span class="tag bad">DRIVING</span>'
        : delta > 0 ? '<span class="tag warn">MOVED</span>'
        : '<span class="tag ok">ON PLAN</span>';
      var tr = el("tr", (driving ? "breach" : delta > 0 ? "shift" : "") + (slippable(n) ? " clickable" : ""));
      tr.innerHTML =
        '<td><b>' + n.label + '</b><span class="sub"> ' + n.name + '</span>' +
          (slips[n.id] ? ' <span class="tag warn">+' + slips[n.id] + 'd slip</span>' : '') + '</td>' +
        '<td><i class="dotc" style="background:' + SYS_COLOR[n.sys] + '"></i>' + SYS_LAB[n.sys] + '</td>' +
        '<td>' + n.level + '</td>' +
        '<td>' + fmt(base.get(n.id).ff) + '</td>' +
        '<td' + (delta > 0 ? ' class="warncell"' : '') + '>' + fmt(f.ff) + '</td>' +
        '<td>' + (delta > 0 ? '<b class="warncell">+' + delta + 'd</b>' : '<span class="dim">·</span>') + '</td>' +
        '<td>' + (hd === Infinity ? '<span class="dim">—</span>' : Math.max(0, hd) + 'd') + '</td>' +
        '<td>' + status + '</td>';
      if (slippable(n)) tr.addEventListener("click", function () { select(n.id); });
      tb.appendChild(tr);
    });
  }

  /* ---------------- export / print ---------------- */
  document.getElementById("btnPng").addEventListener("click", function () {
    var clone = svg.cloneNode(true);
    clone.setAttribute("width", svgW * 2);
    clone.setAttribute("height", svgH * 2);
    var css = document.getElementById("svgcss").textContent;
    var style = document.createElementNS(NS, "style");
    style.textContent = css;
    clone.insertBefore(style, clone.firstChild);
    var xml = new XMLSerializer().serializeToString(clone);
    var img = new Image();
    img.onload = function () {
      var c = document.createElement("canvas");
      c.width = svgW * 2; c.height = svgH * 2;
      var ctx = c.getContext("2d");
      ctx.fillStyle = "#0b1220";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      var a = document.createElement("a");
      a.download = "dependency-cascade.png";
      a.href = c.toDataURL("image/png");
      a.click();
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  });
  document.getElementById("btnPrint").addEventListener("click", function () { window.print(); });

  /* ---------------- boot ---------------- */
  document.getElementById("progMeta").textContent =
    DATA.meta.programme + " · " + DATA.meta.site + " · baseline PFHO " + fmt(basePfho) +
    " · cost of delay " + currency(DATA.meta.costPerDay) + "/day";
  select(srcSel.value || DATA.nodes.filter(slippable)[0].id);
})();
