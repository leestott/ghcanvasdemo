# Demo Script — Agent Runtime Canvas

A tight, timed walkthrough for demoing the **Agent Runtime** canvas
(`leestott/agent-runtime-canvas`). Total runtime: **~8–10 minutes**.

**One-line thesis to open and close with:**
> Traditional UIs are for *using* software. Canvas is for *shaping* software while
> it runs. Canvas is Human-to-AI-to-System — a runtime where things actually
> execute.

---

## Before you start (pre-flight, ~2 min before the room)

- [ ] **GitHub Copilot CLI / app with canvas support** (`canvas-renderer` capability).
- [ ] This repo cloned and opened as the **workspace**:
      `git clone https://github.com/leestott/agent-runtime-canvas.git && cd agent-runtime-canvas`
- [ ] No `npm install` needed — the SDK auto-resolves; the extension uses only Node
      built-ins.
- [ ] Confirm the extension loaded: reload extensions and check that **Agent
      Runtime** appears in the canvas catalog. If it shows *failed*, open the log
      path printed by the inspect output (stdout is reserved for JSON-RPC).
- [ ] Optional: pre-open the canvas once so the iframe is warm, then **Reset
      &#10227;** for a clean stage.

---

## Beat 0 — Frame it (45 sec, talk only)

> "Everyone's first instinct with Canvas is to build a UI — a dashboard, a board.
> That's the trap. Canvas isn't where your *users* live; it's where your *system*
> becomes visible to you and the AI while you're still shaping it. Let me show you
> what I mean with a real multi-agent system."

Contrast to land: **Figma is Human-to-Human. Canvas is Human-to-AI-to-System — and
it actually executes.**

---

## Beat 1 — Design the system (90 sec)

**Say:** "I'll hand the AI a requirement and let it decompose it into a team of
agents."

**Do:** Ask Copilot:
> Open the Agent Runtime canvas with the requirement
> "Add CSV export to the reports page".

Then:
> Call `decompose_system`.

**Point at:** five agents appear — **Planner, Architect, Builder, Validator,
Reviewer** — and a **six-task graph**, all *pending*. Note the **Requirement &
constraints** panel and the **Task Flow** dependency graph.

**Land it:** "I didn't draw this. The AI proposed a system architecture, and it's
live — not a mockup."

---

## Beat 2 — Execute and observe collaboration (2 min)

**Say:** "Now watch the system run. This is the part a normal UI would hide."

**Do:** Click **Run &#9654;** (or ask the agent to `execute_workflow` with
`mode: "run"`, `intervalMs: 1200`).

**Point at:**
- The **activity spotlight** banner naming the agent currently working.
- The **progress bar** filling.
- **Artifacts** appearing as each task completes (`task-breakdown.md`,
  `architecture.md`, `implementation.diff`, ...).
- Agent **status** flipping idle &rarr; working &rarr; done.

**Optional:** hit **Pause &#10074;&#10074;** then **Run &#9654;**, or **Step
&#9655;** one task at a time to slow it down.

**Land it:** "Intermediate state, coordination order, who-did-what — all visible.
That's the observability story."

---

## Beat 3 — Validate (continuous feedback loop) (90 sec)

**Say:** "Shaping a system means constantly asking 'is it still correct?'"

**Do:** Click **Run tests &#10003;** (or `validate_output`).

**Point at:** **5/5 passing**, each with **expected vs. actual** and a one-line
**reasoning**. Read one aloud, e.g. *"Every completed task emitted an artifact —
expected 6 artifacts, actual 6."*

**Land it:** "Validation is a first-class, re-runnable citizen — not an afterthought."

---

## Beat 4 — Break it on purpose (2 min) ⭐ the money shot

**Say:** "Here's why Canvas beats a screenshot. Let's inject a failure and watch the
system react."

**Do:**
1. Click **Inject failure &#9889;** (targets the `build` task).
2. Click **Reset &#10227;**, then **Run &#9654;**.

**Point at:**
- The **build** task goes **failed** (red), its agent to **error**.
- Downstream **validate** and **review** tasks cascade to **blocked**.
- **Validation drops to 4/5.**
- The **Timeline** logs the failure with a before&rarr;after diff.

**Land it:** "A production UI is *designed* to hide this. A Canvas is designed to
*surface* it — temporarily, while you shape the system — then get out of the way."

---

## Beat 5 — Evolve and recover (90 sec)

**Say:** "Now I co-design the fix with the AI on the same live model."

**Do:**
1. Add a constraint in the panel (or ask the agent to `update_system_design`):
   *"CSV export must stream rows, never buffer the full result set."*
2. Optionally ask the agent to `track_state` with a decision object.
3. Click **Clear failure &#9003;** (Reset alone does **not** clear an injected
   failure), then **Reset &#10227;** + **Run &#9654;**.
4. Click **Run tests &#10003;** &rarr; back to **6/6 done, 5/5 passing**.

**Land it:** "Human edits and AI actions funneled through the *same* store. We didn't
toggle between an AI view and a human view — there's one running system, two kinds of
participant."

---

## Beat 6 — Close on the thesis (45 sec, talk only)

> "We just designed, ran, validated, broke, and evolved a multi-agent system — in
> real time, on one shared surface, human and AI together. We never wrote a UI. We
> never shipped a dashboard. We *shaped software while it ran.*"

Optional provocation to leave them with:
> "Figma made Human-to-Human design multiplayer. The open question is whether a
> repo-scoped Canvas can make Human-to-AI-to-System development multiplayer too."

---

## If something goes wrong (recovery moves)

| Symptom | Fix |
|--------|-----|
| Canvas shows *failed* in the catalog | Reload extensions; open the log path from the inspect output |
| Panel looks stale | The iframe reconnects via SSE automatically; if needed, close and re-open the canvas — state persists per `documentId` |
| Failure won't clear | Use **Clear failure &#9003;** — **Reset &#10227;** alone does not clear an injected failure |
| Run too fast/slow for the room | Pass `intervalMs` to `execute_workflow` (e.g. 2000 to slow down) |
| Want a clean slate | **Reset &#10227;**, then re-`decompose_system` |

---

## Quick reference — controls & actions

**Panel controls:** Step &#9655; · Run &#9654; (also resumes) · Pause
&#10074;&#10074; · Inject failure &#9889; · Clear failure &#9003; · Reset &#10227; ·
Run tests &#10003;

**Agent actions:** `decompose_system` · `execute_workflow` · `validate_output` ·
`update_system_design` · `track_state`

**Repo:** https://github.com/leestott/agent-runtime-canvas
