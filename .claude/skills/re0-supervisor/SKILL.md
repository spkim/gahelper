---
name: re0-supervisor
description: "Orchestrate a paperthin development iteration from its saved casebook: choose one gate, delegate bounded work, classify evidence, stop repeated blockers, and send completion through an independent review. Use when a planned re0 cycle should continue without the user manually relaying every worker result."
---

Run one bounded control-plane pass over the current paperthin iteration; coordinate the work, do not become the implementer.

## Goal

`re0-supervisor` sits above the existing cycle instead of replacing it. `re0-plan` still frames the iteration, `re0-loop` still supplies the build-and-drive discipline, `re0-memo` still records learning, and `sip` still owns clean-and-true quality checks. The supervisor reads durable artifacts, assigns one current gate to `re0-worker`, sends apparent completion to an isolated `re0-reviewer`, and leaves a resumable state record so a new or compacted session can continue without reconstructing private reasoning.

## State contract

Use the active `.re0/iteration/<current>/` casebook selected by an explicit path, the sole non-completed iteration, or the most recently modified non-completed iteration when that choice is unambiguous. Store control state in `SUPERVISOR.local.md`; provenance remains local and non-canonical. Preserve existing `DESIGN.local.md`, `WORKFLOW.local.md`, `EVIDENCE.local.md`, and `RETRO.local.md` rather than copying their facts into the state file.

Keep this parseable block current, followed by short human-readable evidence and history:

```text
PAPERTHIN_SUPERVISOR_STATE_V1
MODE=native|compatibility
CASEBOOK=<single-line path>
ITERATION_STATUS=ACTIVE|COMPLETE
CURRENT_GATE=<gate id or NONE>
LAST_STATUS=PASS|FAIL|INCONCLUSIVE|BLOCKED|USER_DECISION_REQUIRED|NEXT_REQUIREMENT_AVAILABLE|CONTINUE_AVAILABLE
BLOCKER_FINGERPRINT=<stable root-cause label or NONE>
SAME_BLOCKER_COUNT=<integer>
WORKER_CYCLES_THIS_RUN=<integer 0..5>
REVIEWER_STATUS=NOT_RUN|PASS|FAIL|INCONCLUSIVE
USER_DECISION_PENDING=yes|no
COMPLETED_GATES=<comma-separated gate ids or NONE>
REMAINING_GATES=<comma-separated gate ids or NONE>
LAST_REPORT=<single-line path or NONE>
GATE_EVIDENCE=<gate=path pairs separated by semicolons, or NONE>
CURRENT_REQUIREMENT=<requirement id or NONE>
NEXT_REQUIREMENT_CANDIDATES=<up to three ranked requirement ids separated by commas, or NONE>
RECOMMENDED_NEXT=<requirement id or NONE>
NEXT_ACTION=<one single-line action or COMPLETE>
```

The casebook remains the source of requirements and evidence. Every state value occupies one line; gate identifiers and paths may not contain commas, semicolons, equals signs, or newlines. State records only orchestration facts, not copied requirement prose. `GATE_EVIDENCE` is the durable index from every completed gate to its proof; the referenced EVIDENCE content remains canonical.

## Workflow

1. Recover before deciding. Read `docs/REQUIREMENTS.md` when present, then the active casebook, current diff, relevant implementation and tests, recorded test results, prior worker/reviewer reports, and blockers. Treat missing optional files as absent evidence, not automatic failure.
2. Select execution mode by capability, never by a guessed CLI version. A `compatibility` value in `~/.re0/paperthin-mode` explicitly forces compatibility mode; `auto` or no file uses capability selection:
   - **native** when the host exposes an official separate-context agent/subagent mechanism; launch worker and reviewer in separate contexts and pass only scope plus artifact paths;
   - **compatibility** otherwise; run the same roles sequentially in the current host, persist each complete report before the next role, and deliberately reread artifacts for the reviewer without relying on the worker's account.
   If capability is unknown, use compatibility mode. Native support is an optimization, not an installation requirement.
3. Normalize the latest role report to one status. Reject malformed or evidence-free `PASS` as `INCONCLUSIVE`.
4. Choose exactly one action from the status table below. Assign only one current gate to the worker. A worker cycle is one assignment plus its report; allow at most five per supervisor invocation.
5. After each report, update `SUPERVISOR.local.md`, write the report using the next unused positive integer as `WORKER-<n>.local.md` or `REVIEWER-<n>.local.md` without overwriting an older report, and update the blocker fingerprint by root cause rather than error wording.
6. When all completion criteria appear satisfied, run `re0-reviewer` in a context independent of the worker. Only reviewer `PASS` completes the iteration. Record completion and run `re0-memo` when the cycle produced a reusable lesson; otherwise state why no memo was earned.
7. After reviewer `PASS`, perform the next-requirement scan below. Completing one iteration does not authorize work on another requirement.
8. If the five-cycle invocation budget ends while a safe, scoped next action remains, return `CONTINUE_AVAILABLE`, persist that action, and stop. A later `/re0-supervisor` resumes it.

## Next-requirement gate

After the current requirement receives reviewer `PASS`:

1. Reread `docs/REQUIREMENTS.md` from disk; do not rely on the copy read at invocation start. If it is absent or cannot be interpreted without guessing its requirement states, persist `USER_DECISION_REQUIRED`, report the missing input, and stop.
2. Identify requirements whose requirement status is `Active` and whose implementation status is partial or unimplemented. Exclude `Deprecated` requirements and anything already proven complete.
3. Check each candidate's stated and code-implied dependencies, unresolved blockers, required user decisions, and whether the current code or completed iteration makes it cheaper or safer to do next.
4. Remove candidates whose unmet dependency or blocker makes them non-executable now. Rank the remainder by: finishing already-partial work; direct continuity with the completed iteration; unblocked dependency order; then the priority recorded in the requirements. Do not invent priority when the document and code provide none.
5. Return at most three candidates with requirement id, requirement status, implementation status, and a short evidence-based reason. Set `RECOMMENDED_NEXT` only when one candidate is actually preferable on those grounds.

Use this handoff shape (labels are stable; explanatory text may vary):

```text
CURRENT_COMPLETED:
<requirement id>

NEXT_REQUIREMENT_CANDIDATES:

1. <requirement id>
   status: Active
   implementation: partial|unimplemented
   reason: <short evidence-based reason>

RECOMMENDED_NEXT:
<requirement id or NONE>

STATE:
NEXT_REQUIREMENT_AVAILABLE|USER_DECISION_REQUIRED
```

When one or more executable candidates exist, persist `NEXT_REQUIREMENT_AVAILABLE`, set `USER_DECISION_PENDING=yes`, make `NEXT_ACTION` ask the user to approve a candidate, and stop. Do not select a new requirement, create a `re0-plan`, open a casebook, dispatch a worker, or mutate product code. When no candidate is executable, persist `USER_DECISION_REQUIRED` and stop: distinguish between no eligible requirement remaining, candidates blocked by dependencies, and a missing product choice or requirements source. `USER_DECISION_REQUIRED` means manual direction is required before any new iteration; it does not imply that a blocker exists.

User approval of a named candidate authorizes only opening the next planning/iteration gate; it does not retroactively merge that work into the completed iteration. An explicit `--auto-next` (or an unambiguous equivalent) on the current supervisor invocation may authorize selecting `RECOMMENDED_NEXT` and opening one new iteration. Treat that flag as single-transition consent: require an unambiguous recommendation, preserve the normal `re0-plan`/casebook contracts, and stop for any protected decision class. Never persist `--auto-next` as standing permission, and never interpret ordinary requests such as “continue” or “finish” as equivalent.

## Status routing

- **PASS** — mark only the evidenced gate complete. If criteria remain, send the next gate to a worker. If none remain, run the reviewer. Reviewer `PASS` completes the iteration.
- **FAIL** — classify first. For a local implementation, fixture, state-transfer, small-code, or test-configuration defect inside scope, send the smallest evidence-backed correction to a worker and re-run the same validation path. For a failed design assumption, security boundary, multi-module redesign, or invalid completion criterion, stop implementation and recommend the user invoke `/hate` first; `/macrothink`, `/prism`, or `/readchk` may follow when their distinct purpose fits. These are user-invoked skills, so never impersonate their invocation.
- **INCONCLUSIVE** — name the missing observation. If a minimal runner, fixture, local server, dependency, or evidence capture fits the iteration, assign that enablement to a worker. Split an infrastructure iteration only when it is independently substantial. Never convert unverified work to `PASS`.
- **BLOCKED** — stop when required authority or an external condition prevents progress. Report the blocker, attempts, evidence, options, and one recommendation.
- **USER_DECISION_REQUIRED** — stop immediately for requirement meaning changes, feature deletion, major scope growth, database migration or data-loss risk, production changes, weakened auth/security, paid services, mutually exclusive product behavior, lowered completion criteria, irreversible change, or a business decision.
- **NEXT_REQUIREMENT_AVAILABLE** — the current iteration is complete and one or more executable Active requirements are ranked for user approval. This is a stop state, not permission to plan or implement the recommendation.

For `FAIL` or `INCONCLUSIVE`, increment `SAME_BLOCKER_COUNT` only when the normalized root cause matches `BLOCKER_FINGERPRINT`. Reset it when the root changes or evidence proves it cleared. At three occurrences, stop automatic work and return `BLOCKED` with the blocker, all attempts, failure evidence, viable choices, and the recommended choice.

## Rules

- Orchestrate; do not implement product features directly.
- Keep work inside the current requirement automatic, but treat entry into every new requirement as a separate authorization gate.
- Trust repository artifacts and executable evidence, not role narration or private reasoning.
- One worker assignment has one gate and the minimum scope needed to prove it.
- Never invoke indefinitely: three same-root occurrences and five worker cycles per supervisor invocation are hard limits.
- Never lower assertions, completion criteria, or security boundaries to obtain `PASS`.
- Do not reopen an evidenced gate unless new evidence shows a regression or dependency invalidates it.
- User-only skills remain user-only. Recommend them with the exact decision they should pressure; do not copy their procedures into this skill.
- A native agent failure falls back to compatibility mode only when sequential execution can preserve the same scope and evidence boundary; otherwise report `INCONCLUSIVE` or `BLOCKED`.
- Compatibility mode separates responsibilities and artifact reads, not model cognition. It may complete when requirement-derived executable evidence is decisive; it must record the weaker isolation and return `INCONCLUSIVE` when fresh-context judgment itself is decisive.

## Verification

Before returning:

1. The state block parses, references the actual casebook, and names one next action or completion.
2. Every completed gate points to evidence; every missing proof remains incomplete.
3. Retry and invocation budgets were counted by root cause and not reset by rewording.
4. Reviewer completion came from an independent context when available, or the documented sequential cold-read fallback.
5. Any required user decision stopped automation before mutation.
6. A completed iteration triggered a fresh requirements scan, and no new requirement was planned or implemented without explicit approval or a current-invocation `--auto-next` equivalent.
