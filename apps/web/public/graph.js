/* Grafo de conocimiento (página /graph): pinta /api/graph con vis-network.
   Los parámetros llegan por la URL de la PÁGINA (URLSearchParams) — sin
   interpolación del servidor dentro del <script>. */
const COLORS = {
  client:"#cf222e", project:"#8250df", service:"#0969da", integration:"#1f883d",
  vendor:"#bf3989", technology:"#9a6700", module:"#bc4c00", person:"#57606a",
  decision:"#0a7ea4", incident:"#d1242f", repository:"#0099ff",
};
const entryColor = "#33415e";
function colorFor(group){
  if(group && group.startsWith("entry:")) return entryColor;
  return COLORS[group] || "#768390";
}
(async () => {
  const qs = new URLSearchParams(location.search);
  // Mismos defaults que el servidor: sin ?project vale el proyecto que el servidor
  // dejó `selected` en el <select> (el primero accesible); entries !== "0" → 1.
  const project = qs.get("project") || document.querySelector('select[name="project"]')?.value || "";
  const entries = qs.get("entries") !== "0" ? 1 : 0;
  const res = await fetch("/api/graph?project="+encodeURIComponent(project)+"&entries="+entries);
  const g = await res.json();
  const deg = {};
  g.edges.forEach(e => { deg[e.from]=(deg[e.from]||0)+1; deg[e.to]=(deg[e.to]||0)+1; });
  const nodes = g.nodes.map(n => ({
    id:n.id, label:n.label, shape: n.kind==="entry"?"box":"dot",
    size: 8 + Math.min(22, (deg[n.id]||0)*2),
    color:{background:colorFor(n.group), border:"#ffffff22"},
    font:{color:"#c9d1d9", size: n.kind==="entry"?11:13},
    _kind:n.kind, _group:n.group,
  }));
  const edges = g.edges.map(e => ({
    from:e.from, to:e.to, label: e.kind==="relation"? e.label : undefined,
    arrows: e.kind==="relation"?"to":undefined,
    color:{color: e.kind==="relation"?"#0099ff88":"#ffffff14"},
    font:{color:"#8b949e", size:9, strokeWidth:0},
    dashes: e.kind==="mention",
  }));
  const data={nodes:new vis.DataSet(nodes), edges:new vis.DataSet(edges)};
  const net=new vis.Network(document.getElementById("net"), data, {
    physics:{barnesHut:{gravitationalConstant:-8000, springLength:120, springConstant:0.03}, stabilization:{iterations:200}},
    interaction:{hover:true, tooltipDelay:120},
    nodes:{borderWidth:1},
  });
  net.on("click", p => {
    if(!p.nodes.length) return;
    const n = data.nodes.get(p.nodes[0]);
    if(n && n._kind==="entry") window.location = "/entry/"+n.id;
  });
  const types=[...new Set(g.nodes.map(n=>n._group||n.group).filter(x=>x&&!x.startsWith("entry:")))];
  document.getElementById("legend").innerHTML =
    "Nodos: "+g.nodes.length+" · Aristas: "+g.edges.length+" &nbsp; | &nbsp; " +
    types.map(t=>'<span style="color:'+colorFor(t)+'">●</span> '+t).join(" &nbsp; ") +
    ' &nbsp; <span style="color:'+entryColor+'">▦</span> entrada';
})();
