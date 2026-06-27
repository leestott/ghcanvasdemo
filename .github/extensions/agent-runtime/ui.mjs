// ui.mjs — renderer for the agent-runtime canvas iframe.
//
// Single self-contained HTML document. It opens an SSE stream to /events,
// renders the SystemModel live, and POSTs human edits/controls back to
// /control. No build step, no dependencies; styled with the app theme tokens
// the host mirrors onto the canvas document.

export function renderHtml() {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Agent Runtime</title>
<style>
:root {
  --ok: var(--true-color-green, #1a7f37);
  --okbg: var(--true-color-green-muted, rgba(26,127,55,.12));
  --bad: var(--true-color-red, #cf222e);
  --badbg: var(--true-color-red-muted, rgba(207,34,46,.12));
  --warn: var(--true-color-yellow, #9a6700);
  --warnbg: var(--true-color-yellow-muted, rgba(154,103,0,.12));
  --run: var(--true-color-blue, #0969da);
  --runbg: var(--true-color-blue-muted, rgba(9,105,218,.12));
  --muted: var(--text-color-muted, #59636e);
  --border: var(--border-color-default, #d1d9e0);
  --bg: var(--background-color-default, #fff);
  --panel: var(--background-color-muted, rgba(0,0,0,.025));
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text-color-default, #1f2328);
  font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  font-size: var(--text-body-medium, 13px);
  line-height: var(--leading-body-medium, 1.5);
}
code, pre, .mono { font-family: var(--font-mono, "SFMono-Regular", Consolas, monospace); }
h1,h2,h3 { font-weight: var(--font-weight-semibold, 600); margin: 0; }
button {
  font: inherit; cursor: pointer; border: 1px solid var(--border);
  background: var(--bg); color: inherit; border-radius: 6px; padding: 4px 9px;
}
button:hover { background: var(--panel); }
button.primary { background: var(--run); color: var(--color-white, #fff); border-color: transparent; }
button.danger { color: var(--bad); border-color: var(--bad); }
button:disabled { opacity: .45; cursor: default; }
input, textarea, select {
  font: inherit; color: inherit; background: var(--bg);
  border: 1px solid var(--border); border-radius: 6px; padding: 4px 7px; width: 100%;
}
textarea { resize: vertical; }

/* layout */
.topbar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 8px 12px; border-bottom: 1px solid var(--border);
  position: sticky; top: 0; background: var(--bg); z-index: 5;
}
.topbar .title { font-weight: 600; font-size: 14px; }
.pill { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border); white-space: nowrap; }
.pill.idle { color: var(--muted); }
.pill.running { color: var(--run); background: var(--runbg); border-color: transparent; }
.pill.paused { color: var(--warn); background: var(--warnbg); border-color: transparent; }
.spacer { flex: 1; }

.grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 12px; padding: 12px; align-items: start; }
@media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
.col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.card { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.card > header {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  border-bottom: 1px solid var(--border); background: var(--panel);
}
.card > header h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
.card .body { padding: 12px; }
.count { font-size: 11px; color: var(--muted); }

/* agents */
.agents { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px,1fr)); gap: 8px; }
.agent { border: 1px solid var(--border); border-radius: 8px; padding: 8px; }
.agent .nm { font-weight: 600; display: flex; align-items: center; gap: 6px; }
.agent .role { color: var(--muted); font-size: 11px; margin-top: 2px; }
.agent .cur { font-size: 11px; margin-top: 5px; }
.dot { width: 8px; height: 8px; border-radius: 999px; display: inline-block; background: var(--muted); }
.s-idle .dot { background: var(--muted); }
.s-working .dot, .s-running .dot { background: var(--run); animation: pulse 1s infinite; }
.s-done .dot { background: var(--ok); }
.s-error .dot, .s-failed .dot { background: var(--bad); }
.s-blocked .dot { background: var(--warn); }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .3; } }

/* task flow graph */
.flow { display: flex; flex-direction: column; gap: 6px; }
.frow { display: flex; align-items: stretch; gap: 8px; }
.tnode {
  flex: 1; border: 1px solid var(--border); border-left-width: 3px; border-radius: 7px;
  padding: 7px 9px; display: flex; flex-direction: column; gap: 2px; cursor: pointer;
}
.tnode:hover { background: var(--panel); }
.tnode .tt { font-weight: 600; font-size: 12px; }
.tnode .ta { font-size: 11px; color: var(--muted); }
.tnode .tstat { font-size: 10px; text-transform: uppercase; letter-spacing: .03em; }
.tnode.st-pending { border-left-color: var(--muted); }
.tnode.st-running { border-left-color: var(--run); background: var(--runbg); }
.tnode.st-done { border-left-color: var(--ok); }
.tnode.st-failed { border-left-color: var(--bad); background: var(--badbg); }
.tnode.st-blocked { border-left-color: var(--warn); background: var(--warnbg); }
.deparrow { text-align: center; color: var(--muted); font-size: 11px; line-height: 1; }

/* validation */
.test { border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; margin-bottom: 7px; }
.test .th { display: flex; align-items: center; gap: 8px; }
.test .tag { font-size: 10px; font-weight: 700; padding: 1px 7px; border-radius: 999px; }
.tag.pass { color: var(--ok); background: var(--okbg); }
.tag.fail { color: var(--bad); background: var(--badbg); }
.tag.pending { color: var(--muted); background: var(--panel); }
.test .why { color: var(--muted); font-size: 11px; margin-top: 4px; }
.test .ea { font-size: 11px; margin-top: 4px; display: flex; gap: 14px; flex-wrap: wrap; }

/* state */
.kv { border: 1px solid var(--border); border-radius: 8px; margin-bottom: 7px; }
.kv > .kvh { display: flex; align-items: center; gap: 8px; padding: 6px 9px; cursor: pointer; }
.kv .k { font-weight: 600; font-family: var(--font-mono, monospace); font-size: 12px; }
.kv .age { font-size: 10px; color: var(--muted); }
.kv pre { margin: 0; padding: 8px 9px; border-top: 1px solid var(--border); white-space: pre-wrap; word-break: break-word; font-size: 11px; max-height: 180px; overflow: auto; }
.kv .edit { padding: 8px 9px; border-top: 1px solid var(--border); display: none; gap: 6px; flex-direction: column; }
.kv.editing .edit { display: flex; }
.kv.editing pre { display: none; }

/* timeline */
.tl { list-style: none; margin: 0; padding: 0; max-height: 320px; overflow: auto; }
.tl li { display: flex; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--border); }
.tl .ico { width: 18px; text-align: center; }
.tl .meta { min-width: 0; }
.tl .sm { font-size: 12px; }
.tl .dt { font-size: 10px; color: var(--muted); }
.tl .df { font-size: 10px; color: var(--muted); font-family: var(--font-mono, monospace); white-space: pre-wrap; word-break: break-word; }

/* artifacts */
.art { border: 1px solid var(--border); border-radius: 8px; margin-bottom: 7px; }
.art > .arth { display: flex; align-items: center; gap: 8px; padding: 6px 9px; cursor: pointer; }
.art .an { font-family: var(--font-mono, monospace); font-size: 12px; font-weight: 600; }
.art pre { margin: 0; padding: 8px 9px; border-top: 1px solid var(--border); white-space: pre-wrap; word-break: break-word; font-size: 11px; max-height: 220px; overflow: auto; display: none; }
.art.open pre { display: block; }
.constraints { display: flex; flex-direction: column; gap: 6px; }
.constraint { display: flex; align-items: center; gap: 8px; border: 1px solid var(--border); border-radius: 7px; padding: 5px 9px; }
.constraint .ck { font-size: 10px; text-transform: uppercase; color: var(--warn); }
.constraint .ct { flex: 1; }
.row { display: flex; gap: 6px; align-items: center; }
.empty { color: var(--muted); font-size: 12px; padding: 4px 0; }
.req { width: 100%; }
.section-controls { display: flex; gap: 6px; flex-wrap: wrap; }
.disconnected { color: var(--bad); }
</style>
</head>
<body>
<div class="topbar">
  <span class="title">⚙︎ Agent Runtime</span>
  <span id="status" class="pill idle">idle</span>
  <span id="conn" class="count">connecting…</span>
  <span class="spacer"></span>
  <div class="section-controls">
    <button id="btn-step" title="Run one ready task">Step ▷</button>
    <button id="btn-run" class="primary" title="Auto-run the workflow">Run ▶</button>
    <button id="btn-pause" title="Pause execution">Pause ❚❚</button>
    <button id="btn-reset" title="Reset all tasks to pending">Reset ⟲</button>
  </div>
</div>

<div class="grid">
  <!-- LEFT: system view -->
  <div class="col">
    <div class="card">
      <header><h2>Requirement</h2><span class="spacer"></span><button id="btn-save-req">Save</button></header>
      <div class="body">
        <textarea id="req" class="req" rows="2" placeholder="Describe the agent feature to design…"></textarea>
        <div class="row" style="margin-top:8px">
          <input id="constraint-in" placeholder="Add a constraint / policy…" />
          <button id="btn-add-constraint">Add</button>
        </div>
        <div id="constraints" class="constraints" style="margin-top:8px"></div>
      </div>
    </div>

    <div class="card">
      <header><h2>Agents</h2><span id="agents-count" class="count"></span></header>
      <div class="body"><div id="agents" class="agents"></div></div>
    </div>

    <div class="card">
      <header><h2>Task Flow</h2><span id="tasks-count" class="count"></span>
        <span class="spacer"></span>
        <button id="btn-inject" class="danger" title="Inject a failure into the next ready task">Inject failure ⚡</button>
      </header>
      <div class="body"><div id="flow" class="flow"></div></div>
    </div>

    <div class="card">
      <header><h2>Artifacts</h2><span id="art-count" class="count"></span></header>
      <div class="body"><div id="artifacts"></div></div>
    </div>
  </div>

  <!-- RIGHT: validation + state + timeline -->
  <div class="col">
    <div class="card">
      <header><h2>Validation</h2><span id="tests-count" class="count"></span>
        <span class="spacer"></span><button id="btn-validate">Run tests ✓</button>
      </header>
      <div class="body"><div id="tests"></div></div>
    </div>

    <div class="card">
      <header><h2>Live State</h2><span id="state-count" class="count"></span></header>
      <div class="body">
        <div id="state"></div>
        <div class="row" style="margin-top:8px">
          <input id="state-key" placeholder="key" style="max-width:120px" />
          <input id="state-val" placeholder='value (json or text)' />
          <button id="btn-set-state">Set</button>
        </div>
      </div>
    </div>

    <div class="card">
      <header><h2>Timeline</h2><span id="tl-count" class="count"></span></header>
      <div class="body"><ul id="timeline" class="tl"></ul></div>
    </div>
  </div>
</div>

<script>
const $ = (s) => document.querySelector(s);
let model = null;
let openArtifacts = new Set();
let openState = new Set();
let editingState = new Set();

function esc(s){ return String(s==null?"":s).replace(/[&<>]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }
function ago(ts){ const d=Date.now()-ts; if(d<1000)return "now"; if(d<60000)return Math.floor(d/1000)+"s"; if(d<3600000)return Math.floor(d/60000)+"m"; return Math.floor(d/3600000)+"h"; }
function fmt(v){ return typeof v==="string"? v : JSON.stringify(v, null, 2); }

async function control(action, payload={}) {
  try {
    await fetch("control", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ action, ...payload }) });
  } catch(e) { /* SSE will reflect state regardless */ }
}

// ---- renderers ----
function render() {
  if (!model) return;
  $("#status").className = "pill " + model.status;
  $("#status").textContent = model.status;

  // requirement (don't clobber while focused)
  if (document.activeElement !== $("#req")) $("#req").value = model.requirement || "";

  renderConstraints();
  renderAgents();
  renderFlow();
  renderArtifacts();
  renderTests();
  renderState();
  renderTimeline();

  $("#btn-run").disabled = model.status === "running";
  $("#btn-pause").disabled = model.status !== "running";
}

function renderConstraints() {
  const el = $("#constraints");
  if (!model.constraints.length) { el.innerHTML = '<div class="empty">No constraints.</div>'; return; }
  el.innerHTML = model.constraints.map(c =>
    '<div class="constraint"><span class="ck">'+esc(c.kind)+'</span><span class="ct">'+esc(c.text)+
    '</span><button data-rm-constraint="'+c.id+'">✕</button></div>').join("");
}

function renderAgents() {
  $("#agents-count").textContent = model.agents.length + " agents";
  $("#agents").innerHTML = model.agents.map(a =>
    '<div class="agent s-'+a.status+'"><div class="nm"><span class="dot"></span>'+esc(a.name)+'</div>'+
    '<div class="role">'+esc(a.role)+'</div>'+
    '<div class="cur">'+(a.currentTask? '▸ '+esc(a.currentTask) : '<span class="count">'+esc(a.status)+'</span>')+'</div></div>').join("");
}

function renderFlow() {
  const t = model.tasks;
  const c = { done: t.filter(x=>x.status==="done").length, total: t.length };
  $("#tasks-count").textContent = c.done + "/" + c.total + " done";
  if (!t.length) { $("#flow").innerHTML = '<div class="empty">No tasks. Ask the agent to decompose_system, or it will seed a demo.</div>'; return; }
  // simple top-down layered list with dep arrows
  $("#flow").innerHTML = t.map((task, i) => {
    const arrow = i>0 ? '<div class="deparrow">│</div>' : '';
    const deps = task.deps && task.deps.length ? ' ◂ depends: '+task.deps.map(d=>{const dt=t.find(x=>x.id===d);return dt?esc(dt.title):"?";}).join(", ") : '';
    return arrow +
      '<div class="frow"><div class="tnode st-'+task.status+'" data-inject="'+esc(task.key)+'">'+
      '<div class="tt">'+esc(task.title)+'</div>'+
      '<div class="ta">'+esc(task.agentName)+(task.output? ' · ⟶ '+esc(task.output):'')+'</div>'+
      '<div class="tstat">'+esc(task.status)+deps+'</div></div></div>';
  }).join("");
}

function renderArtifacts() {
  $("#art-count").textContent = model.artifacts.length;
  const el = $("#artifacts");
  if (!model.artifacts.length) { el.innerHTML = '<div class="empty">No artifacts yet.</div>'; return; }
  el.innerHTML = model.artifacts.map(a =>
    '<div class="art'+(openArtifacts.has(a.id)?' open':'')+'"><div class="arth" data-art="'+a.id+'">'+
    '<span>'+(openArtifacts.has(a.id)?'▾':'▸')+'</span><span class="an">'+esc(a.name)+'</span>'+
    '<span class="count">'+esc(a.agentName)+' · '+ago(a.createdAt)+' ago</span></div>'+
    '<pre>'+esc(a.content)+'</pre></div>').join("");
}

function renderTests() {
  const t = model.tests || [];
  const pass = t.filter(x=>x.status==="pass").length;
  $("#tests-count").textContent = t.length ? (pass+"/"+t.length+" pass") : "";
  const el = $("#tests");
  if (!t.length) { el.innerHTML = '<div class="empty">No tests run. Click “Run tests”.</div>'; return; }
  el.innerHTML = t.map(x =>
    '<div class="test"><div class="th"><span class="tag '+x.status+'">'+esc((x.status||"").toUpperCase())+'</span>'+
    '<strong>'+esc(x.name)+'</strong></div>'+
    '<div class="why">'+esc(x.reasoning||"")+'</div>'+
    '<div class="ea"><span class="count">expected: '+esc(x.expected||"")+'</span><span class="count">actual: '+esc(x.actual||"")+'</span></div></div>').join("");
}

function renderState() {
  const keys = Object.keys(model.state||{});
  $("#state-count").textContent = keys.length + " objects";
  const el = $("#state");
  if (!keys.length) { el.innerHTML = '<div class="empty">No state objects.</div>'; return; }
  el.innerHTML = keys.map(k => {
    const o = model.state[k];
    const editing = editingState.has(k);
    const open = openState.has(k) || editing;
    return '<div class="kv'+(editing?' editing':'')+'"><div class="kvh" data-state="'+esc(k)+'">'+
      '<span>'+(open?'▾':'▸')+'</span><span class="k">'+esc(k)+'</span><span class="spacer"></span>'+
      '<span class="age">'+ago(o.updatedAt)+' ago</span>'+
      '<button data-edit-state="'+esc(k)+'">✎</button>'+
      '<button data-del-state="'+esc(k)+'">✕</button></div>'+
      (open? '<pre>'+esc(fmt(o.value))+'</pre>':'')+
      '<div class="edit"><textarea data-statearea="'+esc(k)+'" rows="4">'+esc(fmt(o.value))+'</textarea>'+
      '<div class="row"><button data-save-state="'+esc(k)+'" class="primary">Save</button>'+
      '<button data-cancel-state="'+esc(k)+'">Cancel</button></div></div></div>';
  }).join("");
}

function renderTimeline() {
  const tl = model.timeline || [];
  $("#tl-count").textContent = tl.length;
  const ico = { decompose:"⊞", execute:"▶", agent:"🤖", error:"⚠︎", validate:"✓", design:"✎", state:"≡", inject:"⚡" };
  $("#timeline").innerHTML = tl.slice(0,60).map(e => {
    let df = "";
    if (e.detail && typeof e.detail === "object" && e.detail.key) {
      df = e.detail.key+": "+fmt(e.detail.from)+" → "+fmt(e.detail.to);
    } else if (e.detail) { df = String(e.detail); }
    return '<li><span class="ico">'+(ico[e.type]||"•")+'</span><div class="meta">'+
      '<div class="sm">'+esc(e.summary)+'</div>'+
      (df? '<div class="df">'+esc(df.length>180?df.slice(0,180)+"…":df)+'</div>':'')+
      '<div class="dt">'+ago(e.ts)+' ago · '+esc(e.type)+'</div></div></li>';
  }).join("");
}

// ---- event delegation ----
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-art],[data-state],[data-rm-constraint],[data-inject],[data-edit-state],[data-del-state],[data-save-state],[data-cancel-state]");
  if (!t) return;
  if (t.dataset.art != null) { const id=t.dataset.art; openArtifacts.has(id)?openArtifacts.delete(id):openArtifacts.add(id); renderArtifacts(); }
  else if (t.dataset.state != null && t.tagName!=="BUTTON") { const k=t.dataset.state; openState.has(k)?openState.delete(k):openState.add(k); renderState(); }
  else if (t.dataset.rmConstraint != null) control("remove_constraint", { id: t.dataset.rmConstraint });
  else if (t.dataset.inject != null) control("inject_failure", { taskKey: t.dataset.inject });
  else if (t.dataset.editState != null) { editingState.add(t.dataset.editState); renderState(); }
  else if (t.dataset.cancelState != null) { editingState.delete(t.dataset.cancelState); renderState(); }
  else if (t.dataset.delState != null) control("delete_state", { key: t.dataset.delState });
  else if (t.dataset.saveState != null) {
    const k=t.dataset.saveState; const area=document.querySelector('[data-statearea="'+CSS.escape(k)+'"]');
    editingState.delete(k); control("edit_state", { key:k, value: area? area.value : "" });
  }
});

$("#btn-step").onclick = () => control("execute", { mode:"step" });
$("#btn-run").onclick = () => control("execute", { mode:"run" });
$("#btn-pause").onclick = () => control("execute", { mode:"pause" });
$("#btn-reset").onclick = () => control("execute", { mode:"reset" });
$("#btn-validate").onclick = () => control("validate");
$("#btn-inject").onclick = () => { const t=(model&&model.tasks||[]).find(x=>x.status==="pending"); if(t) control("inject_failure",{taskKey:t.key}); };
$("#btn-save-req").onclick = () => control("set_requirement", { text: $("#req").value });
$("#btn-add-constraint").onclick = () => { const v=$("#constraint-in").value.trim(); if(v){ control("add_constraint",{text:v}); $("#constraint-in").value=""; } };
$("#constraint-in").addEventListener("keydown", e=>{ if(e.key==="Enter") $("#btn-add-constraint").click(); });
$("#btn-set-state").onclick = () => { const k=$("#state-key").value.trim(); if(k){ control("edit_state",{key:k, value:$("#state-val").value}); $("#state-key").value=""; $("#state-val").value=""; } };

// ---- SSE live stream ----
function connect() {
  const es = new EventSource("events");
  es.onopen = () => { $("#conn").textContent = "● live"; $("#conn").className = "count"; };
  es.onmessage = (ev) => { try { model = JSON.parse(ev.data); render(); } catch(e){} };
  es.onerror = () => { $("#conn").textContent = "● reconnecting…"; $("#conn").className = "count disconnected"; };
}
connect();
</script>
</body>
</html>`;
}
