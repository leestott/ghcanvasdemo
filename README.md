# Agent Runtime — a multi-agent development Canvas

A GitHub Copilot CLI **canvas extension** that turns Canvas into a **runtime
observability & control plane** for a multi-agent software system being designed,
tested, and evolved in real time — *not* a static UI.

The canvas renders one living **SystemModel** that **both humans and the AI agent
edit at the same time**. The agent drives it through five canvas actions; the human
drives it through the panel's controls. Every change streams to the iframe over
Server-Sent Events, so the system visibly evolves through interaction.

## What it demonstrates

> Canvas is not a UI builder — it is a runtime for shaping intelligent systems.

- **Observability** — agents, their roles and live status; a task-flow graph; the
  artifacts each agent emits; a change timeline.
- **Steerability** — trigger agent actions, pause/resume execution, inject failures,
  and edit requirement / constraints / shared state directly in the panel.
- **Continuous validation** — an evaluation suite with pass/fail indicators and
  reasoning, re-runnable as the design changes.

## Panels

| Panel | Shows |
|-------|-------|
| **Requirement & constraints** | The feature under design + editable policies/constraints |
| **Agents** | Active agents, responsibilities, and current state (idle/working/done/error/blocked) |
| **Task Flow** | The dependency graph of tasks across agents, with live status |
| **Artifacts** | Intermediate outputs produced by each task |
| **Validation** | Test cases, pass/fail, expected vs. actual, and reasoning |
| **Live State** | Shared memory objects the agents use — directly human-editable |
| **Timeline** | Change-over-time log, including state before→after diffs |

## Agent actions

The agent co-creates and evolves the system by calling:

| Action | Effect |
|--------|--------|
| `decompose_system` | Break a requirement into collaborating agents + a task-flow graph |
| `execute_workflow` | Coordinate agents to advance tasks (`step`/`run`/`pause`/`resume`/`reset`) |
| `validate_output` | Run evaluation tests, return structured pass/fail + reasoning |
| `update_system_design` | Modify architecture/logic: requirement, constraints, agents, tasks |
| `track_state` | Persist/update a shared state object, recording the diff on the timeline |

## Scenarios

- **Design a feature end-to-end** — open with a `requirement`; the agent calls
  `decompose_system`, then `execute_workflow` to watch agents collaborate.
- **Observe collaboration** — Run the workflow and watch agent states, the task
  graph, and artifacts update live.
- **Inject failure / constraints** — click *Inject failure ⚡* (or the agent injects
  one); downstream tasks become *blocked* and the system adapts.
- **Iterate via validation loops** — run tests, see what fails and why, call
  `update_system_design`, re-run, re-validate.

## Layout

```
.github/extensions/agent-runtime/
  extension.mjs   # wiring: loopback server, SSE, /control, 5 canvas actions
  store.mjs       # durable SystemModel + execution engine + validation
  ui.mjs          # iframe renderer (system view · validation · state · timeline)
```

## Run it

In the Copilot CLI / app with this repo as the workspace:

1. The extension is auto-discovered from `.github/extensions/`.
2. Ask Copilot to **open the Agent Runtime canvas** (optionally with a requirement),
   or open it from the canvas catalog.
3. Use the panel controls, and/or ask the agent to `decompose_system`,
   `execute_workflow`, and `validate_output`.

State persists per `documentId` under `~/.copilot/extensions/agent-runtime/artifacts/`.

## How it works

- The iframe is served from a loopback HTTP server (one per open instance) and
  subscribes to `/events` (SSE). It POSTs human controls to `/control`.
- The `SystemStore` is an `EventEmitter`: every mutation bumps a version, appends a
  timeline entry, persists to disk, and broadcasts a fresh snapshot to all panels.
- Canvas actions and human controls funnel through the *same* store, so the agent
  and the human are editing one shared, live system.

---

Built as a demonstration of the Copilot Canvas extension runtime.
