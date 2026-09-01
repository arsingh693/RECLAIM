# Revenue Recovery Agent

Razorpay Buildathon — Track 03, AI Revenue Recovery.

Takes a batch of failed payments, works out *why* each one failed, chooses the right recovery action and the right timing, executes it inside hard guardrails, stops when it should, and logs every decision so a human can audit it.

> **Status: in progress.** The domain layer and its invariant suite are done. Gateway, policy, guardrails, orchestrator, metrics and console are not built yet. This README describes the design; the Built / Not built section below is kept honest as work lands.

---

## The problem

When a payment fails, that revenue is usually just lost. Most systems respond in one of two ways: do nothing, or retry the same charge on a fixed ladder — day 1, day 3, day 7 — and then give up.

The fixed ladder is wrong for most failures, because a decline is not one thing:

| The failure | What a fixed ladder does | What is actually correct |
|---|---|---|
| Insufficient funds on the 28th | Retries tomorrow, fails again | Wait for payday, then retry |
| Card expired | Retries three times, fails three times | Stop retrying; ask for new details |
| Bank temporarily down | Waits two days | Retry in minutes, or switch rail now |
| Gateway timed out | Retries, possibly double-charging | Reconcile first, then decide |
| Blocked by risk engine | Retries around a fraud block | Never retry; hand to a human |

Same amount, same product, five different correct actions. Choosing between them is what this project does.

## The core design decision

Authority is split in two, and the split is the point.

**What is permitted is decided by code.** `src/domain/declineCodes.ts` maps every decline code to hard constraints: whether the charge may be re-presented on the same instrument, the ceiling on total automated charge attempts, and a whitelist of permitted actions. This is plain data and plain logic. No model involved.

**What is best among permitted options is decided by the model.** Given a payment and the constraints that apply to it, the policy picks an action and a time, and explains why. It cannot widen the whitelist, raise the ceiling, or invent an action outside the closed catalog in `src/domain/interventions.ts`. If it tries, the guardrail layer rejects the decision and falls back to a deterministic default.

This is a deliberate answer to "where did you choose *not* to use AI." Whether we are allowed to charge someone a fourth time, contact them at 2 AM, or retry around a fraud block are not questions that should be settled by a language model. Timing a retry to a customer's likely payday is exactly the kind of judgment a model is good at. The boundary is drawn to match.

A useful consequence: because the constraint table is data, properties can be asserted *across* it. `scripts/checkInvariants.ts` checks ten of them — a zero attempt ceiling must permit no attempt-consuming action, a risk-category code must never permit customer contact, an ambiguous outcome must force reconciliation before any money moves, every code must have a terminal action so nothing can cycle forever. A contradictory rule fails the build rather than surfacing halfway through a batch run. It has already caught two real contradictions; both are written up in `CHANGELOG.md`.

## Why the reported metrics use a simulated gateway

The headline claim is a comparison: *the agent recovered more than the fixed ladder, on the same batch.* That claim is only honest if the batch is reproducible. A nondeterministic gateway means running twice gives two different numbers, and the comparison stops meaning anything.

So the default gateway is a deterministic simulator driven by a seeded PRNG. Same seed, same batch, same outcomes, every run. This is a requirement of the measurement, not a shortcut around the API.

A real Razorpay adapter sits behind the same `PaymentGateway` interface. It uses Razorpay REST primitives that are actually supported by the platform: reconciliation through the Payments API, and customer-facing recovery through Payment Links / Orders. It does **not** fake a server-side arbitrary charge call; Razorpay documents the Payments API as a retrieve/capture surface, not a generic collection endpoint. The deterministic simulator remains the measurement path because it can reproduce the complete decline taxonomy and outcome sequence. When the real adapter is used, the README and UI will label exactly which operations were provider-backed.

## Architecture

```
src/domain/          types, decline taxonomy, action catalog   [done]
src/gateway/         PaymentGateway interface, simulator, Razorpay adapter
src/policy/          model-backed intervention selection + deterministic fallback
src/guardrails/      attempt caps, quiet hours, opt-out, dispute freeze
src/orchestrator/    chunked, resumable batch runner
src/metrics/         agent vs baseline comparison
src/app/             the operator console
scripts/             seed generator, invariant checks
```

The batch runner processes in resumable chunks rather than one long pass. That keeps it deployable on serverless, and more importantly it is what makes an interrupted run recoverable instead of fatal.

## Running it

Requires Node 20 or newer.

```bash
npm install
cp .env.example .env.local     # works as-is; no keys needed to start
npm run verify                 # typecheck + taxonomy invariants
```

`LLM_PROVIDER=stub` and `PAYMENT_GATEWAY=simulated` are the defaults, so the pipeline runs end to end with no API keys at all. Add a key and switch the provider when you want the model in the loop.

## Built / not built

| Component | Status |
|---|---|
| Domain types, money as integer paise | done |
| Decline taxonomy, 12 codes with hard constraints | done |
| Action catalog, 10 bounded interventions | done |
| Invariant suite over the constraint table | done |
| `PaymentGateway` interface + deterministic simulator | done |
| Razorpay REST adapter (reconcile + recovery-link/order primitives) | done |
| Seed batch generator | not started |
| Policy (model + deterministic fallback) | not started |
| Guardrail layer | not started |
| Chunked batch orchestrator | not started |
| Baseline retry ladder | not started |
| Metrics harness | not started |
| Operator console | not started |

## Judgment calls worth knowing about

`RETRY_NOW` is not permitted for `INSUFFICIENT_FUNDS`. An immediate retry against an empty account cannot succeed and spends one of only three attempts.

`ISSUER_UNAVAILABLE` permits no customer contact at all. A bank outage is not the customer's problem, and messaging them about it is pure cost with no recovery value.

`RISK_BLOCKED` permits only human escalation or stopping. For that code the correct recovery rate is zero — a system reporting recoveries there is doing something wrong.

`GATEWAY_TIMEOUT` authorises no charge attempt whatsoever. It is not a chargeable state, it is an unresolved one; reconciliation collapses it into the truth and the payment is then re-decided under its real decline code.

Escalating to a human counts as a success in the metrics, not a failure. A recovery system that never escalates is one that has been told to guess.
