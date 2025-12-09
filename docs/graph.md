# 知识图谱 / 技能树

- 节点大小 = 连接数（越核心越大）
- 加密节点显示为 ?????，但仍保留连线
- 点节点跳转文章

<label>主题筛选：</label>
<select id="topicFilter">
  <option value="__all__">全部</option>
</select>

<div id="graph" style="width:100%;height:75vh;border:1px solid #ddd;border-radius:8px;margin-top:8px;"></div>

<script src="https://unpkg.com/force-graph"></script>
<script>
(async function () {
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
  const Graph = ForceGraph()(el)
    .nodeId('id')
    .nodeLabel(n => n.locked ? '?????' : n.title)
    .nodeAutoColorBy('topic')
    .nodeVal(n => (n.degree ?? 0) + 1)   // 核心：度数越大节点越大（至少为 1）
    .linkDirectionalParticles(0)
    .onNodeClick(n => { if (n.url) window.location.href = n.url; });

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
