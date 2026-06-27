// store.mjs — durable SystemModel + execution engine for the agent-runtime canvas.
//
// The SystemModel is the single source of truth that humans (via the iframe) and
// the AI agent (via canvas actions) both mutate. It is an EventEmitter so every
// mutation broadcasts a fresh snapshot to connected SSE clients, and it persists
// to a JSON artifact under ~/.copilot so it survives iframe/extension reloads.

import { EventEmitter } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const COPILOT_HOME = process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot");
const ARTIFACT_DIR = path.join(COPILOT_HOME, "extensions", "agent-runtime", "artifacts");

let counter = 0;
const uid = (p = "id") => `${p}_${(++counter).toString(36)}${Date.now().toString(36).slice(-3)}`;
const now = () => Date.now();

// ---------------------------------------------------------------------------
// Default decomposition templates. decompose_system turns a free-text
// requirement into a believable multi-agent pipeline so a single call produces
// a rich, observable system graph.
// ---------------------------------------------------------------------------

const DEFAULT_AGENTS = [
    { name: "Planner", role: "Decompose requirements into a task graph and sequence work." },
    { name: "Architect", role: "Design system structure, data shapes, and agent contracts." },
    { name: "Builder", role: "Implement tasks and emit concrete artifacts." },
    { name: "Validator", role: "Run evaluation tests and judge output quality." },
    { name: "Reviewer", role: "Inspect results, surface risks, and request changes." },
];

// Each pipeline stage: title, which agent owns it, what artifact it emits, and
// which state keys it reads/writes. deps wire the task-flow graph.
const PIPELINE = [
    { key: "analyze", title: "Analyze requirement", agent: "Planner", artifact: "task-breakdown.md", writes: ["requirements"] },
    { key: "design", title: "Design architecture", agent: "Architect", artifact: "architecture.md", reads: ["requirements"], writes: ["design"], deps: ["analyze"] },
    { key: "build", title: "Implement core logic", agent: "Builder", artifact: "implementation.diff", reads: ["design"], writes: ["build"], deps: ["design"] },
    { key: "wire", title: "Wire agent contracts", agent: "Builder", artifact: "contracts.json", reads: ["design"], writes: ["contracts"], deps: ["design"] },
    { key: "validate", title: "Validate outputs", agent: "Validator", artifact: "eval-report.json", reads: ["build", "contracts"], writes: ["evaluation"], deps: ["build", "wire"] },
    { key: "review", title: "Review & decide", agent: "Reviewer", artifact: "review-notes.md", reads: ["evaluation"], writes: ["decision"], deps: ["validate"] },
];

function emptyModel(id) {
    return {
        id,
        requirement: "",
        status: "idle", // idle | running | paused
        version: 0,
        activeAgentId: null,
        activeTaskId: null,
        constraints: [],
        agents: [],
        tasks: [],
        edges: [],
        artifacts: [],
        tests: [],
        state: {}, // shared memory objects: key -> { value, updatedAt }
        timeline: [],
        injectedFailures: [], // task keys flagged to fail on next run
        updatedAt: now(),
        createdAt: now(),
    };
}

export class SystemStore extends EventEmitter {
    constructor(id) {
        super();
        this.setMaxListeners(0);
        this.id = id;
        this.model = emptyModel(id);
        this._timer = null;
        this._finishTimer = null;
        this._dwellMs = 1100;
        this._saveQueued = false;
        this._file = path.join(ARTIFACT_DIR, `${sanitize(id)}.json`);
    }

    async load() {
        try {
            const raw = await readFile(this._file, "utf8");
            const parsed = JSON.parse(raw);
            this.model = { ...emptyModel(this.id), ...parsed, id: this.id };
        } catch {
            // No persisted model yet — seed a small illustrative demo so the
            // canvas is never blank on first open.
            this.seedDemo();
        }
        return this.model;
    }

    snapshot() {
        return this.model;
    }

    // -- internal mutation helper: bump version, timestamp, persist, broadcast.
    _commit(eventType, summary, detail) {
        this.model.version += 1;
        this.model.updatedAt = now();
        if (eventType) {
            this.model.timeline.unshift({
                id: uid("ev"),
                ts: now(),
                type: eventType,
                summary,
                detail: detail || null,
            });
            this.model.timeline = this.model.timeline.slice(0, 200);
        }
        this._queueSave();
        this.emit("change", this.model);
        return this.model;
    }

    _queueSave() {
        if (this._saveQueued) return;
        this._saveQueued = true;
        setTimeout(async () => {
            this._saveQueued = false;
            try {
                await mkdir(ARTIFACT_DIR, { recursive: true });
                await writeFile(this._file, JSON.stringify(this.model, null, 2), "utf8");
            } catch {
                /* persistence is best-effort */
            }
        }, 150);
    }

    // -----------------------------------------------------------------------
    // decompose_system
    // -----------------------------------------------------------------------
    decompose(requirement, opts = {}) {
        const req = (requirement || this.model.requirement || "Untitled agent feature").trim();
        this.model.requirement = req;
        this.model.status = "idle";

        // Build agents (custom or default).
        const agentDefs = Array.isArray(opts.agents) && opts.agents.length ? opts.agents : DEFAULT_AGENTS;
        const agents = agentDefs.map((a) => ({
            id: uid("agent"),
            name: a.name,
            role: a.role || "",
            status: "idle", // idle | working | blocked | done | error
            currentTask: null,
        }));
        const byName = new Map(agents.map((a) => [a.name, a]));

        // Build the task graph from the pipeline template.
        const stages = Array.isArray(opts.tasks) && opts.tasks.length ? opts.tasks : PIPELINE;
        const keyToId = {};
        const tasks = stages.map((s) => {
            const agent = byName.get(s.agent) || agents[0];
            const id = uid("task");
            keyToId[s.key] = id;
            return {
                id,
                key: s.key,
                title: s.title,
                agentId: agent.id,
                agentName: agent.name,
                status: "pending", // pending | running | done | failed | blocked
                deps: [],
                depKeys: s.deps || [],
                reads: s.reads || [],
                writes: s.writes || [],
                artifactName: s.artifact || null,
                output: null,
            };
        });
        for (const t of tasks) t.deps = t.depKeys.map((k) => keyToId[k]).filter(Boolean);
        const edges = [];
        for (const t of tasks) for (const d of t.deps) edges.push({ from: d, to: t.id });

        this.model.agents = agents;
        this.model.tasks = tasks;
        this.model.edges = edges;
        this.model.artifacts = [];
        this.model.tests = [];
        this.model.activeAgentId = null;
        this.model.activeTaskId = null;
        this.model.state = {
            requirements: { value: req, updatedAt: now() },
        };
        this._commit("decompose", `Decomposed system into ${tasks.length} tasks / ${agents.length} agents`, req);
        return this.summary();
    }

    // -----------------------------------------------------------------------
    // execute_workflow — advance the task graph.
    // mode: "step" (one task), "run" (auto-run on a timer), "pause", "resume",
    //       "reset" (back to pending).
    // -----------------------------------------------------------------------
    execute(mode = "step", opts = {}) {
        const dwell = Math.max(250, Number(opts.intervalMs) || this._dwellMs || 1100);
        switch (mode) {
            case "reset":
                this._stopTimer();
                for (const t of this.model.tasks) {
                    t.status = "pending";
                    t.output = null;
                }
                for (const a of this.model.agents) {
                    a.status = "idle";
                    a.currentTask = null;
                }
                this.model.artifacts = [];
                this.model.tests = [];
                // Clear produced memory, preserving the requirement seed.
                this.model.state = this.model.requirement
                    ? { requirements: { value: this.model.requirement, updatedAt: now() } }
                    : {};
                this.model.activeAgentId = null;
                this.model.activeTaskId = null;
                this.model.status = "idle";
                return this._commit("execute", "Execution reset to pending");
            case "pause":
                this._stopTimer();
                this.model.status = "paused";
                // Roll any mid-flight task back to pending so it re-runs on resume.
                for (const t of this.model.tasks) if (t.status === "running") t.status = "pending";
                for (const a of this.model.agents) if (a.status === "working") { a.status = "idle"; a.currentTask = null; }
                this.model.activeAgentId = null;
                this.model.activeTaskId = null;
                return this._commit("execute", "Execution paused");
            case "resume":
            case "run":
                this._dwellMs = dwell;
                this.model.status = "running";
                this._commit("execute", mode === "resume" ? "Execution resumed" : "Execution started");
                this._scheduleTick(0);
                return this.summary();
            case "step":
            default:
                // One full, visible task: begin (running) → dwell → finish.
                this._stopTimer();
                this._runOneTask(dwell);
                return this.summary();
        }
    }

    // Drive the auto-run loop. Each tick advances exactly one task through its
    // visible begin→finish lifecycle, so the active agent is observable.
    _scheduleTick(delay) {
        this._stopTimer();
        this._timer = setTimeout(() => {
            if (this.model.status !== "running") return;
            const more = this._beginNext();
            if (!more) return; // workflow settled (complete or blocked)
            // After the running dwell, finish the in-flight task, then loop.
            this._finishTimer = setTimeout(() => {
                if (this.model.status !== "running") return;
                this._finishActive();
                this._scheduleTick(Math.round(this._dwellMs * 0.4));
            }, this._dwellMs);
            if (typeof this._finishTimer.unref === "function") this._finishTimer.unref();
        }, Math.max(0, delay));
        if (typeof this._timer.unref === "function") this._timer.unref();
    }

    // Manual single step: begin now, finish after the dwell.
    _runOneTask(dwell) {
        const began = this._beginNext();
        if (!began) return;
        this._finishTimer = setTimeout(() => this._finishActive(), dwell);
        if (typeof this._finishTimer.unref === "function") this._finishTimer.unref();
    }

    _stopTimer() {
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
        if (this._finishTimer) { clearTimeout(this._finishTimer); this._finishTimer = null; }
    }

    _readyTask() {
        return this.model.tasks.find(
            (t) =>
                t.status === "pending" &&
                t.deps.every((d) => {
                    const dep = this.model.tasks.find((x) => x.id === d);
                    return dep && dep.status === "done";
                }),
        );
    }

    // Phase 1: pick the next ready task and mark it + its agent active.
    // Returns false (and settles the run) when nothing can start.
    _beginNext() {
        const task = this._readyTask();
        if (!task) {
            // Mark the whole transitively-blocked subtree (deps failed/blocked),
            // iterating to a fixpoint so downstream tasks are flagged too.
            let changed = true;
            while (changed) {
                changed = false;
                for (const t of this.model.tasks) {
                    if (t.status !== "pending") continue;
                    const bad = t.deps.some((d) => {
                        const dep = this.model.tasks.find((x) => x.id === d);
                        return dep && (dep.status === "failed" || dep.status === "blocked");
                    });
                    if (bad) { t.status = "blocked"; changed = true; }
                }
            }
            const blocked = this.model.tasks.filter((t) => t.status === "blocked");
            this.model.activeAgentId = null;
            this.model.activeTaskId = null;
            if (this.model.status === "running") {
                this.model.status = "idle";
                this._stopTimer();
            }
            const remaining = this.model.tasks.some((t) => t.status === "pending" || t.status === "running");
            this._commit(
                blocked.length ? "error" : "execute",
                blocked.length ? `${blocked.length} task(s) blocked by upstream failure` : (remaining ? "No ready tasks" : "Workflow complete ✓"),
            );
            return false;
        }

        const agent = this.model.agents.find((a) => a.id === task.agentId);
        task.status = "running";
        this.model.activeTaskId = task.id;
        this.model.activeAgentId = agent ? agent.id : null;
        if (agent) {
            agent.status = "working";
            agent.currentTask = task.title;
        }
        this._commit("agent", `▶ ${task.agentName} is working on “${task.title}”`, "running");
        return true;
    }

    // Phase 2: complete the currently-running task (or fail it if injected).
    _finishActive() {
        const task = this.model.tasks.find((t) => t.id === this.model.activeTaskId) ||
            this.model.tasks.find((t) => t.status === "running");
        if (!task) return this.model;
        const agent = this.model.agents.find((a) => a.id === task.agentId);
        const shouldFail = this.model.injectedFailures.includes(task.key);

        this.model.activeAgentId = null;
        this.model.activeTaskId = null;

        if (shouldFail) {
            task.status = "failed";
            task.output = `Failed: injected constraint violated during "${task.title}".`;
            if (agent) { agent.status = "error"; agent.currentTask = null; }
            this.model.injectedFailures = this.model.injectedFailures.filter((k) => k !== task.key);
            return this._commit("error", `✕ ${task.agentName} failed “${task.title}”`, task.output);
        }

        const artifact = {
            id: uid("art"),
            taskId: task.id,
            agentName: task.agentName,
            name: task.artifactName || `${task.key}.txt`,
            type: extType(task.artifactName),
            content: synthArtifact(task, this.model),
            createdAt: now(),
        };
        this.model.artifacts.unshift(artifact);
        task.output = artifact.name;
        for (const key of task.writes) this._setStateInternal(key, synthState(key, task, this.model));

        task.status = "done";
        if (agent) { agent.status = "done"; agent.currentTask = null; }
        return this._commit("agent", `✓ ${task.agentName} completed “${task.title}” → ${artifact.name}`, artifact.name);
    }

    // -----------------------------------------------------------------------
    // validate_output — run evaluation tests, return structured results.
    // -----------------------------------------------------------------------
    validate(customTests) {
        let tests;
        if (Array.isArray(customTests) && customTests.length) {
            tests = customTests.map((t) => this._evalTest(normalizeTest(t)));
        } else {
            tests = this._defaultTests().map((t) => this._evalTest(t));
        }
        this.model.tests = tests;
        const passed = tests.filter((t) => t.status === "pass").length;
        this._commit("validate", `Validation: ${passed}/${tests.length} passing`);
        return { tests, passed, total: tests.length };
    }

    _defaultTests() {
        const t = (name, target, assertion) => ({ id: uid("test"), name, target, assertion });
        return [
            t("All tasks reach a terminal state", "tasks", "no_pending"),
            t("No tasks failed", "tasks", "none_failed"),
            t("Every completed task emitted an artifact", "artifacts", "artifact_per_done"),
            t("Design state populated before build", "state", "design_before_build"),
            t("Decision recorded by Reviewer", "state", "has_decision"),
        ];
    }

    _evalTest(test) {
        const { tasks, artifacts, state } = this.model;
        let pass = false;
        let reasoning = "";
        let expected = "";
        let actual = "";
        switch (test.assertion) {
            case "no_pending": {
                const pend = tasks.filter((x) => x.status === "pending" || x.status === "running");
                expected = "0 pending/running";
                actual = `${pend.length} pending/running`;
                pass = tasks.length > 0 && pend.length === 0;
                reasoning = pass ? "All tasks reached done/failed/blocked." : `Still in flight: ${pend.map((x) => x.title).join(", ") || "—"}.`;
                break;
            }
            case "none_failed": {
                const failed = tasks.filter((x) => x.status === "failed");
                expected = "0 failed";
                actual = `${failed.length} failed`;
                pass = failed.length === 0;
                reasoning = pass ? "No task failures detected." : `Failures: ${failed.map((x) => x.title).join(", ")}.`;
                break;
            }
            case "artifact_per_done": {
                const done = tasks.filter((x) => x.status === "done");
                const withArt = done.filter((x) => artifacts.some((a) => a.taskId === x.id));
                expected = `${done.length} artifacts`;
                actual = `${withArt.length} artifacts`;
                pass = done.length > 0 && withArt.length === done.length;
                reasoning = pass ? "Every completed task produced an artifact." : "Some completed tasks have no artifact.";
                break;
            }
            case "design_before_build": {
                const hasDesign = !!state.design;
                const hasBuild = !!state.build;
                expected = "design precedes build";
                actual = `design=${hasDesign} build=${hasBuild}`;
                pass = !hasBuild || hasDesign;
                reasoning = pass ? "Design state available before/with build." : "Build ran without a design state object.";
                break;
            }
            case "has_decision": {
                expected = "decision present";
                actual = state.decision ? "present" : "absent";
                pass = !!state.decision;
                reasoning = pass ? "Reviewer recorded a decision." : "No decision state recorded yet.";
                break;
            }
            default: {
                // Generic: pass if the named state/artifact target exists.
                const exists = !!state[test.target] || artifacts.some((a) => a.name === test.target);
                expected = test.expected || "target exists";
                actual = exists ? "found" : "missing";
                pass = test.expectedPass != null ? test.expectedPass === exists : exists;
                reasoning = pass ? "Assertion satisfied." : "Assertion not satisfied.";
            }
        }
        return { ...test, status: pass ? "pass" : "fail", reasoning, expected, actual, evaluatedAt: now() };
    }

    // -----------------------------------------------------------------------
    // update_system_design — modify architecture/logic based on feedback.
    // -----------------------------------------------------------------------
    updateDesign(changes = {}) {
        const applied = [];
        if (changes.requirement != null) {
            this.model.requirement = String(changes.requirement);
            applied.push("requirement");
        }
        if (Array.isArray(changes.addConstraints)) {
            for (const c of changes.addConstraints) {
                this.model.constraints.push({ id: uid("c"), text: typeof c === "string" ? c : c.text, kind: (c && c.kind) || "rule" });
            }
            applied.push(`+${changes.addConstraints.length} constraints`);
        }
        if (Array.isArray(changes.removeConstraintIds)) {
            this.model.constraints = this.model.constraints.filter((c) => !changes.removeConstraintIds.includes(c.id));
            applied.push("removed constraints");
        }
        if (Array.isArray(changes.addAgents)) {
            for (const a of changes.addAgents) {
                this.model.agents.push({ id: uid("agent"), name: a.name, role: a.role || "", status: "idle", currentTask: null });
            }
            applied.push(`+${changes.addAgents.length} agents`);
        }
        if (Array.isArray(changes.updateAgents)) {
            for (const u of changes.updateAgents) {
                const a = this.model.agents.find((x) => x.id === u.id || x.name === u.name);
                if (a) {
                    if (u.role != null) a.role = u.role;
                    if (u.name != null) a.name = u.name;
                }
            }
            applied.push("updated agents");
        }
        if (Array.isArray(changes.addTasks)) {
            for (const tk of changes.addTasks) {
                const agent = this.model.agents.find((x) => x.name === tk.agent) || this.model.agents[0];
                const id = uid("task");
                const deps = (tk.deps || []).map((title) => {
                    const dt = this.model.tasks.find((x) => x.title === title || x.key === title || x.id === title);
                    return dt ? dt.id : null;
                }).filter(Boolean);
                this.model.tasks.push({
                    id, key: tk.key || id, title: tk.title, agentId: agent ? agent.id : null,
                    agentName: agent ? agent.name : "?", status: "pending", deps, depKeys: [],
                    reads: tk.reads || [], writes: tk.writes || [], artifactName: tk.artifact || null, output: null,
                });
                for (const d of deps) this.model.edges.push({ from: d, to: id });
            }
            applied.push(`+${changes.addTasks.length} tasks`);
        }
        this._commit("design", `Design updated: ${applied.join(", ") || "no-op"}`);
        return this.summary();
    }

    // -----------------------------------------------------------------------
    // track_state — persist/update shared memory objects with a recorded diff.
    // -----------------------------------------------------------------------
    trackState(key, value) {
        const prev = this.model.state[key] ? this.model.state[key].value : undefined;
        this._setStateInternal(key, value);
        const diff = { key, from: prev, to: value };
        this._commit("state", `State "${key}" updated`, diff);
        return { key, previous: prev, current: value };
    }

    _setStateInternal(key, value) {
        this.model.state[key] = { value, updatedAt: now() };
    }

    // -----------------------------------------------------------------------
    // Human / iframe controls
    // -----------------------------------------------------------------------
    setRequirement(text) {
        this.model.requirement = String(text || "");
        return this._commit("design", "Requirement edited by human");
    }
    addConstraint(text, kind = "rule") {
        if (!text) return this.model;
        this.model.constraints.push({ id: uid("c"), text: String(text), kind });
        return this._commit("design", `Constraint added: ${text}`);
    }
    removeConstraint(id) {
        this.model.constraints = this.model.constraints.filter((c) => c.id !== id);
        return this._commit("design", "Constraint removed");
    }
    injectFailure(taskKey) {
        // Accept key, id, or title.
        const task = this.model.tasks.find((t) => t.key === taskKey || t.id === taskKey || t.title === taskKey);
        const key = task ? task.key : taskKey;
        if (!this.model.injectedFailures.includes(key)) this.model.injectedFailures.push(key);
        return this._commit("inject", `Failure injected into "${task ? task.title : key}"`);
    }
    clearFailures() {
        this.model.injectedFailures = [];
        return this._commit("inject", "Injected failures cleared");
    }
    editState(key, rawValue) {
        let value = rawValue;
        try { value = JSON.parse(rawValue); } catch { /* keep as string */ }
        return this.trackState(key, value);
    }
    deleteState(key) {
        delete this.model.state[key];
        return this._commit("state", `State "${key}" removed by human`);
    }

    summary() {
        const m = this.model;
        const byStatus = (arr, s) => arr.filter((x) => x.status === s).length;
        return {
            id: m.id,
            requirement: m.requirement,
            status: m.status,
            version: m.version,
            agents: m.agents.length,
            tasks: {
                total: m.tasks.length,
                done: byStatus(m.tasks, "done"),
                running: byStatus(m.tasks, "running"),
                pending: byStatus(m.tasks, "pending"),
                failed: byStatus(m.tasks, "failed"),
                blocked: byStatus(m.tasks, "blocked"),
            },
            artifacts: m.artifacts.length,
            tests: { total: m.tests.length, pass: byStatus(m.tests, "pass"), fail: byStatus(m.tests, "fail") },
            constraints: m.constraints.length,
            stateKeys: Object.keys(m.state),
        };
    }

    seedDemo() {
        this.decompose("Add an AI triage agent that classifies inbound support tickets, drafts replies, and escalates high-risk cases.");
        this.addConstraint("Escalate any ticket mentioning a security breach within 5 minutes.", "policy");
        this.addConstraint("Never auto-send replies to enterprise-tier customers.", "policy");
    }

    dispose() {
        this._stopTimer();
        this.removeAllListeners();
    }
}

// ---------------------------------------------------------------------------
// Synthesis helpers — produce believable artifact/state content as the
// simulated agents "work". Deterministic and dependency-free.
// ---------------------------------------------------------------------------

function synthArtifact(task, model) {
    const req = model.requirement;
    switch (task.key) {
        case "analyze":
            return `# Task breakdown\nRequirement: ${req}\n\n- Identify agent roles\n- Define task flow\n- Establish success criteria\n- Map shared state objects`;
        case "design":
            return `# Architecture\nAgents: ${model.agents.map((a) => a.name).join(", ")}\nFlow: Planner → Architect → Builder → Validator → Reviewer\nState: requirements, design, build, contracts, evaluation, decision`;
        case "build":
            return `--- a/agent.mjs\n+++ b/agent.mjs\n@@\n+ // implements: ${req}\n+ export async function run(input) { /* ... */ }`;
        case "wire":
            return JSON.stringify({ contracts: model.agents.map((a) => ({ agent: a.name, in: "task", out: "artifact" })) }, null, 2);
        case "validate":
            return JSON.stringify({ ran: true, checks: 5, note: "see validation panel" }, null, 2);
        case "review":
            return `# Review\nRequirement satisfied pending validation.\nRisks: latency on escalation path.\nDecision: proceed to iteration.`;
        default:
            return `Artifact for ${task.title} (${req}).`;
    }
}

function synthState(key, task, model) {
    switch (key) {
        case "requirements":
            return model.requirement;
        case "design":
            return { agents: model.agents.map((a) => a.name), flow: "linear+branch", stateKeys: ["requirements", "design", "build", "contracts", "evaluation", "decision"] };
        case "build":
            return { module: "agent.mjs", status: "implemented", loc: 42 };
        case "contracts":
            return model.agents.map((a) => ({ agent: a.name, in: "task", out: "artifact" }));
        case "evaluation":
            return { checks: 5, note: "computed by validate_output" };
        case "decision":
            return { outcome: "iterate", confidence: 0.78 };
        default:
            return { producedBy: task.agentName, at: now() };
    }
}

function normalizeTest(t) {
    if (typeof t === "string") return { id: uid("test"), name: t, target: t, assertion: "generic" };
    return {
        id: t.id || uid("test"),
        name: t.name || t.target || "test",
        target: t.target || "",
        assertion: t.assertion || "generic",
        expected: t.expected,
        expectedPass: t.expectedPass,
    };
}

function extType(name) {
    if (!name) return "text";
    const ext = name.split(".").pop().toLowerCase();
    if (["json"].includes(ext)) return "json";
    if (["md"].includes(ext)) return "markdown";
    if (["diff", "patch"].includes(ext)) return "diff";
    return "text";
}

function sanitize(s) {
    return String(s).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "default";
}
