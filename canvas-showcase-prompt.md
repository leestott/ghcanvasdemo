# Canvas Showcase Prompt — "Shaping a System While It Runs"

A copy-paste prompt for a **software engineer / AI engineer** to drive the
**Agent Runtime** canvas in this repo and showcase the real power of Canvas:
not building a UI, but *shaping, testing, and evolving a multi-agent system while it
runs*.

> Positioning to keep in mind while you run this: **Traditional UIs are for *using*
> software. Canvas is for *shaping* software while it runs.** Canvas is
> Human-to-AI-to-System — a runtime where things actually execute, not a static
> design.

---

## The prompt (paste this to Copilot)

```text
You are my AI pair engineer. We are using the Agent Runtime canvas in this
workspace as a live runtime + observability surface — NOT as a UI we ship to
users. Treat the canvas as the place where we shape, test, and evolve a
multi-agent system together while it runs. Narrate each step briefly before you
act so a human watching can follow.

1. DESIGN
   Open the Agent Runtime canvas with the requirement:
   "Add CSV export to the reports page, respecting per-tenant row limits."
   Then call decompose_system to break it into collaborating agents and a
   task-flow graph. Tell me which agents you created and why.

2. EXECUTE (observe collaboration)
   Call execute_workflow with mode "run" and an intervalMs of about 1200 so I
   can watch the active agent move through the task graph and emit artifacts.
   As it runs, point out which agent is working and what artifact each task
   produces.

3. VALIDATE (continuous feedback loop)
   Call validate_output to run the evaluation suite. Read back each test as
   expected vs. actual with its reasoning, and tell me whether the system is
   healthy.

4. STRESS IT (steerability + failure observability)
   Inject a failure into the "build" task, reset, and run again. Explain how
   the failure propagates: which downstream tasks become blocked and why, and
   what validation now reports. This is the kind of intermediate state a
   production UI should hide but a Canvas should surface.

5. EVOLVE (shape the system, then re-validate)
   Based on what failed, call update_system_design to add a constraint
   ("CSV export must stream rows, never buffer the full result set") and call
   track_state to record a shared-state decision. Clear the failure, reset,
   run, and validate again. Walk me through the Timeline before/after diffs.

6. REFLECT
   Summarize what we just did in terms of the thesis: how Canvas let us
   co-create, observe, and evolve a living system in real time instead of
   writing static code — and what this would have cost us to discover if we had
   built a UI first.
```

---

## Why this prompt showcases Canvas

- **It refuses the UI trap.** The prompt explicitly frames the canvas as a runtime
  to shape the system, not a panel to ship.
- **It exercises all five agent actions** — `decompose_system`,
  `execute_workflow`, `validate_output`, `update_system_design`, `track_state`.
- **It makes observability the star** — failure propagation, blocked tasks, and
  before&rarr;after state diffs are exactly what a production UI hides and what
  Canvas should expose.
- **It closes the feedback loop** — design &rarr; execute &rarr; validate &rarr;
  evolve &rarr; re-validate, all on one shared, live model that the human and the AI
  edit together.

## Variations to try

- **Your own requirement:** swap step 1 for a feature from your real backlog.
- **Human-in-the-loop:** instead of asking the agent to run, drive the panel buttons
  yourself (**Run &#9654;**, **Pause &#10074;&#10074;**, **Inject failure &#9889;**,
  **Run tests &#10003;**) and let the agent narrate — proving both participants edit
  the same model.
- **Speed control:** pass a larger `intervalMs` (e.g. 2000) for a presentation, or a
  small one for a fast smoke test.
