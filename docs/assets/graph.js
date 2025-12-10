// GRAPHJS_SIGNATURE=STAR6_v999 20251210_014952
(async function () {
  const topicColorCache = new Map();

  function topicKey(topic) {
    return (topic || "root").toString().trim().toLowerCase();
  }

  function hashTopic(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h * 31 + str.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  function topicColor(topic) {
    const key = topicKey(topic);
    if (topicColorCache.has(key)) return topicColorCache.get(key);

    // Deterministic hue spread; new topics automatically get a stable color
    const h = hashTopic(key);
    const hue = (h * 137.508) % 360; // golden-angle spacing
    const color = `hsl(${hue.toFixed(1)}, 70%, 55%)`;
    topicColorCache.set(key, color);
    return color;
  }

  function withAlpha(color, alpha) {
    if (color.startsWith("#")) {
      const hex = color.slice(1);
      const v = parseInt(hex.length === 3 ? hex.split("").map(c => c + c).join("") : hex, 16);
      const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
      return `rgba(${r},${g},${b},${alpha})`;
    }
    if (color.startsWith("hsl(")) {
      return color.replace("hsl", "hsla").replace(")", `,${alpha})`);
    }
    return color;
  }

  function faded(color) {
    return withAlpha(color, 0.35);
  }

  const LINK_COLORS = {
    oneway: "#c0c4c7",
    mutual: "#2e7d32",
    cross: "#d32f2f"
  };

  const el = document.getElementById("graph");
  const sel = document.getElementById("topicFilter");
  if (!el || !sel) return;

  const res = await fetch("/assets/graph.json");
  const raw = await res.json();

  const topics = Array.from(new Set(raw.nodes.map(n => n.topic))).sort();
  for (const t of topics) {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    sel.appendChild(opt);
  }

  function normalizePath(path) {
    if (!path) return "/";
    let p = path.trim();
    if (!p.startsWith("/")) p = "/" + p;
    if (!p.endsWith("/")) p = p + "/";
    return p;
  }

  function storageUnlocked(path) {
    try {
      const key = "unlock:" + normalizePath(path);
      return !!sessionStorage.getItem(key);
    } catch (e) {
      return false;
    }
  }

  function isNodeUnlocked(n) {
    if (!n.locked) return true;
    if (n.url && storageUnlocked(n.url)) return true;
    return false;
  }

  function drawArrow(ctx, x1, y1, x2, y2, color) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (!len) return;
    const ux = dx / len, uy = dy / len;

    const tipX = x2 - ux * 12;
    const tipY = y2 - uy * 12;

    const size = 6;
    const leftX = tipX - ux * size - uy * size;
    const leftY = tipY - uy * size + ux * size;
    const rightX = tipX - ux * size + uy * size;
    const rightY = tipY - uy * size - ux * size;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(leftX, leftY);
    ctx.lineTo(rightX, rightY);
    ctx.closePath();
    ctx.fill();
  }

  // 六芒星（12 个点交替半径）
  function drawStar6(ctx, x, y, rOuter, rInner) {
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const a = (Math.PI / 6) * i - Math.PI / 2;
      const r = (i % 2 === 0) ? rOuter : rInner;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  const Graph = ForceGraph()(el)
    .nodeId("id")
    .nodeLabel(n => (n.locked ? (n.code || "LOCK") : n.title))
    .nodeVal(n => ((n.degree || 0) + 1 + (n.hub ? 6 : 0)))
    .nodeRelSize(6)
    .nodeCanvasObject((n, ctx, globalScale) => {
      const baseLabel = n.locked ? (n.code || "LOCK") : n.title;
      const locked = n.locked && !isNodeUnlocked(n);
      const color = locked ? faded(topicColor(n.topic)) : topicColor(n.topic);

      const baseR = 6 + Math.min(10, (n.degree || 0));
      const r = n.hub ? (baseR + 8) : baseR;

      ctx.save();

      if (n.hub) {
        // 发光
        ctx.shadowColor = color;
        ctx.shadowBlur = 22;

        // 六芒星
        drawStar6(ctx, n.x, n.y, r, r * 0.45);

        // 白底 + 彩边
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.stroke();

        // 关掉阴影避免文字发糊
        ctx.shadowBlur = 0;
        ctx.shadowColor = "transparent";
      } else {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }

      const fontSize = n.hub ? 14 : 12;
      ctx.font = (fontSize / globalScale) + "px sans-serif";
      ctx.fillStyle = "#111";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";

      let shown = locked ? ("🔒 " + baseLabel) : baseLabel;
      if (n.hub && shown.length > 18) shown = shown.slice(0, 18) + "";
      if (!n.hub && shown.length > 22) shown = shown.slice(0, 22) + "";

      ctx.fillText(shown, n.x, n.y + r + 2);
      ctx.restore();
    })
    .linkDirectionalParticles(0)
    .linkCanvasObjectMode(() => "after")
    .linkCanvasObject((link, ctx) => {
      const c = LINK_COLORS[link.type] || "#c0c4c7";
      const sx = link.source.x, sy = link.source.y;
      const tx = link.target.x, ty = link.target.y;

      ctx.strokeStyle = c;
      ctx.lineWidth = (link.type === "mutual") ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);
      ctx.stroke();

      if (link.dir === "both") {
        drawArrow(ctx, sx, sy, tx, ty, c);
        drawArrow(ctx, tx, ty, sx, sy, c);
      } else if (link.dir === "a2b") {
        drawArrow(ctx, sx, sy, tx, ty, c);
      } else if (link.dir === "b2a") {
        drawArrow(ctx, tx, ty, sx, sy, c);
      }
    })
    .onNodeClick(n => { if (n.url) window.location.href = n.url; });

  Graph.d3Force("charge").strength(-180);
  Graph.d3Force("link").distance(l => (l.type === "cross" ? 160 : 100));

  function applyFilter(topic) {
    if (topic === "__all__") {
      Graph.graphData(raw);
      return;
    }
    const keep = new Set(raw.nodes.filter(n => n.topic === topic).map(n => n.id));
    const nodes = raw.nodes.filter(n => keep.has(n.id));
    const links = raw.links.filter(e => keep.has(e.source) && keep.has(e.target));
    Graph.graphData({ nodes, links });
  }

  sel.addEventListener("change", () => applyFilter(sel.value));

  function resize() {
    Graph.width(el.clientWidth);
    Graph.height(el.clientHeight);
  }
  window.addEventListener("resize", resize);
  window.addEventListener("storage", (e) => {
    if (e.key && e.key.startsWith("unlock:")) {
      Graph.refresh();
    }
  });

  if (document.querySelector(".encrypted-content")) {
    const unlockObserver = new MutationObserver(() => {
      Graph.refresh();
    });
    unlockObserver.observe(document.body, { childList: true, subtree: true });
  }

  applyFilter("__all__");
  resize();
})();


