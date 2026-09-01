# Build log

Razorpay Buildathon — Track 03, AI Revenue Recovery.
Project name: *TBD*

This file has two jobs. It tracks what got built, and it captures what broke while the detail is still fresh. The second job matters more: the application's last question is "what broke, and how you got out," and the site says that's the one they read first. It cannot be faked on day seven. Write entries the same day, badly if necessary.

---

## Incidents worth telling

*Curated from the entries below. This section becomes the form answer.*

**The invariant that revealed I hadn't decided what a timeout *is*.** Encoding the decline taxonomy as data let me assert properties across the whole table instead of per-case. The suite failed on its first run, and the failure looked pedantic: `GATEWAY_TIMEOUT` declared a ceiling of two charge attempts while permitting no action that actually consumes an attempt. My first instinct was that the check was too strict. It wasn't — it had caught that I was modelling the code as "a failure you retry carefully" when a timeout is really "a state where you don't yet know the truth." Those need different representations. A timeout authorises no charge at all; reconciliation collapses it into the real outcome, and the payment is re-decided under *that* code with *that* code's budget. My version would have double-counted the attempt budget across two states and, in the worst case, double-charged someone. Full detail in the 2026-08-27 entry.

---

## 2026-08-27 — Day 1, domain layer

**Shipped**
Next.js + TypeScript scaffold. Domain layer complete: core types, the 12-code decline taxonomy with hard constraints, the closed 10-action intervention catalog, and an invariant suite over the constraint table. `npm run verify` runs typecheck plus invariants. README documents the design and keeps an honest built/not-built table.

Money is an integer count of paise throughout. No floats anywhere near a rupee figure, so the recovered-amount headline can't drift through rounding.

**Decisions and why**

*Authority is split in two.* Code decides what is **permitted** — same-instrument retryability, the attempt ceiling, the whitelist of actions. The model decides what is **best** among permitted options. The model cannot widen the whitelist, raise the ceiling, or invent an action. This is the deliberate answer to the rubric's "where did you choose not to use AI": whether we may charge someone a fourth time is not a question for a language model; timing a retry to their likely payday is.

*The constraint rationale is fed verbatim into the model prompt.* `describeTaxonomyForPrompt()` generates prompt text from the same objects the guardrails enforce, so the model is never offered an option the guardrails would reject, and the reasoning a reviewer reads is the reasoning the model receives. One source of truth.

*Simulated gateway is the default, and that's a measurement requirement rather than a shortcut.* The headline claim is a comparison against a baseline on the same batch. That's only honest if the batch is reproducible, so the gateway is deterministic and seeded. The real Razorpay adapter sits behind the same interface for the integration story.

**Broke**

Two contradictions in the constraint table, both caught before any of it ran in anger.

*First: one boolean doing two jobs.* I had a single `retryable` flag per decline code. `CARD_EXPIRED` was `retryable: false` with `maxAttempts: 0`, while also permitting `RETRY_ALTERNATE_RAIL`. That's incoherent — switching rails **is** a charge attempt, so the profile simultaneously forbade and permitted charging. The flag was conflating two genuinely different questions: may we re-present on the rail that just failed, and how many charge attempts are permitted in total across any rail. An expired card blocks the first but not the second; a risk block blocks both. Split into `sameInstrumentRetryable` and `maxChargeAttempts`.

*Second, and more interesting: the invariant suite caught what my own reading had missed.* Having split the flags, I wrote ten invariants over the table and ran them. One failed:

```
✗ GATEWAY_TIMEOUT: maxChargeAttempts is 2 but no permitted action
  ever consumes an attempt — the ceiling is meaningless and misleading
```

What I saw: a ceiling of 2 alongside an action list of only `RECONCILE_THEN_DECIDE` and `ESCALATE_HUMAN`, neither of which charges anything.

What I thought was wrong: the invariant. It looked like it was complaining about a harmless unused number.

What was actually wrong: the model. I had never decided what `GATEWAY_TIMEOUT` *represents*. I'd been treating it as a failure you retry cautiously, and wrote `2` as a hedge without following the consequence. But a timeout isn't a failure mode at all — it's the absence of information. It authorises no charge whatsoever. Reconciling collapses it into the truth: either the money already landed and there's nothing to recover, or the charge definitively failed with a real decline code. The payment is then re-decided under that code, subject to that code's own ceiling. Keeping a ceiling on the ambiguous state would have double-counted the attempt budget across two states — the timeout spends two, the resolved code spends its own three — which in the worst case means charging someone who was already charged.

What I changed: `GATEWAY_TIMEOUT` is now `sameInstrumentRetryable: false, maxChargeAttempts: 0`, with the state-transition reasoning written into the rationale so it reaches the model too. Invariants pass: 12 codes, 10 interventions.

The transferable lesson is that the invariant was more right than my prose. I had written a paragraph of confident rationale for that code and it read fine; the contradiction only surfaced when a machine compared the numbers to the action list.

**Open questions**
Whether Razorpay test mode can produce a usable spread of decline codes. Less load-bearing now that the simulator is explicitly the measurement path, but still needed for the integration story. Not yet verified — no account.

Still need a project name for the form.

No submission deadline found in any source material. Needs confirming.

---

<!-- Copy this block for each new entry.

## YYYY-MM-DD — Day N

**Shipped**


**Decisions and why**


**Broke**
What I saw. What I thought was wrong. What was actually wrong. What I changed.


**Open questions**


-->

## 2026-08-31 — Gateway boundary

**Shipped**

- Added the `PaymentGateway` abstraction.
- Added a deterministic, seeded, idempotent simulator.
- Added a Razorpay REST adapter for reconciliation plus provider-native recovery primitives (Payment Links and Orders).
- Added gateway checks for determinism and idempotent replay.

**Decisions and why**

The real adapter does not implement a fictional `charge()` HTTP call. Razorpay's current Payments API documentation describes that surface as retrieving payment details and capturing authorized payments, while Orders and Payment Links provide supported collection primitives. The adapter therefore fails closed for direct arbitrary server-side charging and exposes supported recovery primitives instead.

The simulator remains the benchmark gateway because the buildathon's recovery comparison needs deterministic, reproducible outcomes across the exact same seeded batch.

**Broke**

No new defect discovered in this step. The provider documentation check did, however, invalidate the earlier assumption that a generic server-side `charge()` operation could be mapped directly to `/v1/payments`. That assumption has been removed from the implementation rather than hidden behind a misleading adapter.

**Open questions**

The exact Razorpay product path for every recovery intervention (especially recurring/tokenized collection) will be selected when the orchestration layer is built. We will not claim an unsupported operation merely to make the demo look more complete.
