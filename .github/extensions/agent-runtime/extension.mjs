// extension.mjs — agent-runtime canvas.
//
// Wires a loopback HTTP server (per open instance) that serves the iframe UI,
// streams the live SystemModel over SSE, and accepts human control POSTs — plus
// five agent-facing canvas actions (decompose_system, execute_workflow,
// validate_output, update_system_design, track_state) that mutate the same
// shared model so humans and the AI agent co-edit one running system.

import { createServer } from "node:http";
import { joinSession, createCanvas } from "@github/copilot-sdk/extension";
import { SystemStore } from "./store.mjs";
import { renderHtml } from "./ui.mjs";

// docId -> SystemStore (durable model). Multiple canvas instances of the same
// document share one store, so every open panel stays in sync.
const stores = new Map();
// instanceId -> { server, url, docId, clients:Set<res>, unsub }
const servers = new Map();
const instanceDoc = new Map(); // instanceId -> docId (for action routing)

let sdkSession = null;
const log = (msg, level = "info") => {
    try {
        sdkSession?.log?.(msg, { level });
    } catch {
        /* never throw from logging */
    }
};

async function getStore(docId) {
    let store = stores.get(docId);
    if (!store) {
        store = new SystemStore(docId);
        await store.load();
        stores.set(docId, store);
    }
    return store;
}

function docFor(instanceId, input) {
    return (
        instanceDoc.get(instanceId) ||
        (input && (input.documentId || input.docId)) ||
        "default"
    );
}

function sendJson(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(body);
}

async function readBody(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!raw) return {};
    try {
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

// Map a control action coming from the iframe onto the store.
function applyControl(store, body) {
    const { action } = body;
    switch (action) {
        case "execute":
            return store.execute(body.mode || "step", body);
        case "validate":
            return store.validate(body.tests);
        case "decompose":
            return store.decompose(body.requirement, body);
        case "set_requirement":
            return store.setRequirement(body.text);
        case "add_constraint":
            return store.addConstraint(body.text, body.kind);
        case "remove_constraint":
            return store.removeConstraint(body.id);
        case "inject_failure":
            return store.injectFailure(body.taskKey);
        case "clear_failures":
            return store.clearFailures();
        case "edit_state":
            return store.editState(body.key, body.value);
        case "delete_state":
            return store.deleteState(body.key);
        case "update_design":
            return store.updateDesign(body.changes || body);
        default:
            return null;
    }
}

async function startServer(instanceId, docId) {
    const store = await getStore(docId);
    const clients = new Set();

    // Broadcast every model change to all connected SSE clients.
    const onChange = (model) => {
        const payload = `data: ${JSON.stringify(model)}\n\n`;
        for (const res of clients) {
            try {
                res.write(payload);
            } catch {
                clients.delete(res);
            }
        }
    };
    store.on("change", onChange);

    const server = createServer(async (req, res) => {
        const url = new URL(req.url, "http://127.0.0.1");
        const route = url.pathname.replace(/\/+$/, "") || "/";

        if (route === "/" && req.method === "GET") {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
            res.end(renderHtml());
            return;
        }

        if (route === "/model" && req.method === "GET") {
            return sendJson(res, 200, store.snapshot());
        }

        if (route === "/events" && req.method === "GET") {
            res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-store",
                Connection: "keep-alive",
            });
            res.write(`retry: 2000\n\n`);
            res.write(`data: ${JSON.stringify(store.snapshot())}\n\n`);
            clients.add(res);
            const ping = setInterval(() => {
                try {
                    res.write(`: ping\n\n`);
                } catch {
                    /* ignore */
                }
            }, 15000);
            if (typeof ping.unref === "function") ping.unref();
            req.on("close", () => {
                clearInterval(ping);
                clients.delete(res);
            });
            return;
        }

        if (route === "/control" && req.method === "POST") {
            const body = await readBody(req);
            try {
                applyControl(store, body);
                return sendJson(res, 200, { ok: true });
            } catch (err) {
                return sendJson(res, 400, { ok: false, error: String((err && err.message) || err) });
            }
        }

        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    return {
        server,
        url: `http://127.0.0.1:${port}/`,
        docId,
        clients,
        unsub: () => store.off("change", onChange),
    };
}

// ---------------------------------------------------------------------------
// Canvas declaration
// ---------------------------------------------------------------------------

const canvas = createCanvas({
    id: "agent-runtime",
    displayName: "Agent Runtime",
    description:
        "Live runtime/observability & control plane for a multi-agent system under development: agents, task-flow graph, artifacts, validation tests, shared state, and a change timeline that humans and the agent co-edit.",
    inputSchema: {
        type: "object",
        properties: {
            documentId: { type: "string", description: "Stable id for the system model to open (defaults to 'default')." },
            requirement: { type: "string", description: "Optional requirement to decompose into agents+tasks when opening a fresh model." },
        },
        additionalProperties: false,
    },
    actions: [
        {
            name: "decompose_system",
            description: "Break a requirement into collaborating agents and a task-flow graph. Resets the working model.",
            inputSchema: {
                type: "object",
                properties: {
                    requirement: { type: "string", description: "The feature/requirement to design." },
                    agents: {
                        type: "array",
                        description: "Optional explicit agents.",
                        items: { type: "object", properties: { name: { type: "string" }, role: { type: "string" } }, required: ["name"] },
                    },
                    tasks: { type: "array", description: "Optional explicit pipeline stages.", items: { type: "object" } },
                    documentId: { type: "string" },
                },
                required: ["requirement"],
                additionalProperties: true,
            },
            handler: async (ctx) => {
                const store = await getStore(docFor(ctx.instanceId, ctx.input));
                return store.decompose(ctx.input.requirement, ctx.input);
            },
        },
        {
            name: "execute_workflow",
            description: "Coordinate agents to advance the task graph: step one task, run (auto), pause, resume, or reset.",
            inputSchema: {
                type: "object",
                properties: {
                    mode: { type: "string", enum: ["step", "run", "pause", "resume", "reset"], description: "Execution control mode." },
                    intervalMs: { type: "number", description: "Auto-run step interval in ms (run/resume)." },
                    documentId: { type: "string" },
                },
                additionalProperties: true,
            },
            handler: async (ctx) => {
                const store = await getStore(docFor(ctx.instanceId, ctx.input));
                return store.execute((ctx.input && ctx.input.mode) || "step", ctx.input || {});
            },
        },
        {
            name: "validate_output",
            description: "Run evaluation tests against current outputs/state and return structured pass/fail results with reasoning.",
            inputSchema: {
                type: "object",
                properties: {
                    tests: {
                        type: "array",
                        description: "Optional custom tests; omit to run the default suite.",
                        items: { type: "object", properties: { name: { type: "string" }, target: { type: "string" }, assertion: { type: "string" } } },
                    },
                    documentId: { type: "string" },
                },
                additionalProperties: true,
            },
            handler: async (ctx) => {
                const store = await getStore(docFor(ctx.instanceId, ctx.input));
                return store.validate(ctx.input && ctx.input.tests);
            },
        },
        {
            name: "update_system_design",
            description: "Modify architecture/logic based on feedback: edit requirement, add/remove constraints, add/update agents, add tasks.",
            inputSchema: {
                type: "object",
                properties: {
                    requirement: { type: "string" },
                    addConstraints: { type: "array", items: {} },
                    removeConstraintIds: { type: "array", items: { type: "string" } },
                    addAgents: { type: "array", items: { type: "object" } },
                    updateAgents: { type: "array", items: { type: "object" } },
                    addTasks: { type: "array", items: { type: "object" } },
                    documentId: { type: "string" },
                },
                additionalProperties: true,
            },
            handler: async (ctx) => {
                const store = await getStore(docFor(ctx.instanceId, ctx.input));
                return store.updateDesign(ctx.input || {});
            },
        },
        {
            name: "track_state",
            description: "Persist/update a shared memory object the agents use, recording the before→after diff on the timeline.",
            inputSchema: {
                type: "object",
                properties: {
                    key: { type: "string", description: "State object key." },
                    value: { description: "Any JSON value to store." },
                    documentId: { type: "string" },
                },
                required: ["key"],
                additionalProperties: true,
            },
            handler: async (ctx) => {
                const store = await getStore(docFor(ctx.instanceId, ctx.input));
                return store.trackState(ctx.input.key, ctx.input.value);
            },
        },
    ],

    open: async (ctx) => {
        const input = ctx.input || {};
        const docId = (input.documentId || input.docId || "default").toString();
        instanceDoc.set(ctx.instanceId, docId);

        let entry = servers.get(ctx.instanceId);
        if (!entry) {
            entry = await startServer(ctx.instanceId, docId);
            servers.set(ctx.instanceId, entry);
        }

        // If a fresh requirement was supplied and the model has no tasks yet,
        // decompose so the canvas opens onto a populated system.
        const store = await getStore(docId);
        if (input.requirement && store.snapshot().tasks.length === 0) {
            store.decompose(input.requirement, input);
        }

        log(`Agent Runtime canvas open (doc=${docId})`);
        return { title: "Agent Runtime", status: store.snapshot().status, url: entry.url };
    },

    onClose: async (ctx) => {
        const entry = servers.get(ctx.instanceId);
        if (entry) {
            servers.delete(ctx.instanceId);
            try {
                entry.unsub();
            } catch {
                /* ignore */
            }
            for (const res of entry.clients) {
                try {
                    res.end();
                } catch {
                    /* ignore */
                }
            }
            await new Promise((resolve) => entry.server.close(() => resolve()));
        }
        instanceDoc.delete(ctx.instanceId);
    },
});

sdkSession = await joinSession({ canvases: [canvas] });
log("agent-runtime extension ready");
