# 知识图谱 / 技能树

- 节点大小 = 连接数（越核心越大）
- 私密节点显示稳定代号（如 LOCK-7Q2F3A），不泄露标题
- 连线规则：
  - 单向：1 个箭头（灰色）
  - 双向：2 个箭头（一条线，绿色）
  - 跨主题：红色（仍按单/双画箭头）
- 点节点跳转文章

<label>主题筛选：</label>
<select id="topicFilter">
  <option value="__all__">全部</option>
</select>

<div id="graph" style="width:100%;height:75vh;border:1px solid #ddd;border-radius:8px;margin-top:8px;"></div>

<script src="https://unpkg.com/force-graph"></script>
<script>
(async function () {
  const TOPIC_COLORS = {
    linux:    "#1e88e5",
    ai:       "#8e24aa",
    math:     "#2e7d32",
    economic: "#fb8c00",
    root:     "#546e7a"
  };

  const LINK_COLORS = {
    oneway: "#c0c4c7",
    mutual: "#2e7d32",
    cross:  "#d32f2f"
  };

  const res = await fetch('/assets/graph.json');
  const raw = await res.json();

  const sel = document.getElementById('topicFilter');
  const topics = Array.from(new Set(raw.nodes.map(n => n.topic))).sort();
  for (const t of topics) {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    sel.appendChild(opt);
  }

  const el = document.getElementById('graph');

  function drawArrow(ctx, x1, y1, x2, y2, color) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (!len) return;
    const ux = dx / len, uy = dy / len;

    // 箭头位置：靠近目标点，但避开节点圆
    const arrowOffset = 12;
    const tipX = x2 - ux * arrowOffset;
    const tipY = y2 - uy * arrowOffset;

    const size = 6;
    const leftX  = tipX - ux * size - uy * size;
    const leftY  = tipY - uy * size + ux * size;
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

  const Graph = ForceGraph()(el)
    .nodeId('id')
    .nodeLabel(n => n.locked ? (n.code || 'LOCK') : n.title)
    .nodeVal(n => (n.degree ?? 0) + 1)
    .nodeRelSize(6)
    .nodeColor(n => n.locked ? "#9aa0a6" : (TOPIC_COLORS[n.topic] || TOPIC_COLORS.root))
    .linkDirectionalParticles(0) // 关闭内置方向粒子
    .linkCanvasObjectMode(() => 'after')
    .linkCanvasObject((link, ctx) => {
      const c = LINK_COLORS[link.type] || "#c0c4c7";

      // 画线（force-graph 默认会画线，我们这里加粗/上色覆盖）
      const sx = link.source.x, sy = link.source.y;
      const tx = link.target.x, ty = link.target.y;

      ctx.strokeStyle = c;
      ctx.lineWidth = (link.type === "mutual") ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);
      ctx.stroke();

      // 画箭头：dir = a2b / b2a / both
      if (link.dir === "both") {
        drawArrow(ctx, sx, sy, tx, ty, c);
        drawArrow(ctx, tx, ty, sx, sy, c);
      } else if (link.dir === "a2b") {
        drawArrow(ctx, sx, sy, tx, ty, c);
      } else if (link.dir === "b2a") {
        // 注意：source/target 仍是固定顺序，这里箭头要指向 source
        drawArrow(ctx, tx, ty, sx, sy, c);
      }
    })
    .onNodeClick(n => { if (n.url) window.location.href = n.url; });

  // 让图更聚一点
  Graph.d3Force('charge').strength(-180);
  Graph.d3Force('link').distance(l => l.type === "cross" ? 150 : 95);

  function applyFilter(topic) {
    if (topic === '__all__') {
      Graph.graphData(raw);
      return;
    }
    const keep = new Set(raw.nodes.filter(n => n.topic === topic).map(n => n.id));
    const nodes = raw.nodes.filter(n => keep.has(n.id));
    const links = raw.links.filter(e => keep.has(e.source) && keep.has(e.target));
    Graph.graphData({ nodes, links });
  }

  sel.addEventListener('change', () => applyFilter(sel.value));

  function resize() {
    Graph.width(el.clientWidth);
    Graph.height(el.clientHeight);
  }
  window.addEventListener('resize', resize);

  applyFilter('__all__');
  resize();
})();
</script>
