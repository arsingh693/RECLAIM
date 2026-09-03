# What Broke at 2 AM

## Measure it. Trace it. Fix it. Re-run it.

RECLAIM was not built in one clean pass.

The final system looks deliberate because the engineering process was not.

The recovery benchmark initially exposed a severe performance regression. Once the recovery path became more complex, the UI and verification tooling also began exposing contract mismatches between the layers of the system.

Instead of treating those failures as isolated bugs, we used them to tighten the architecture.

The debugging loop became:

```text
Measure
   ↓
Trace
   ↓
Fix
   ↓
Re-run
   ↓
Prove
```

The result was not just a better recovery number.

It was a recovery system with a clearer authority boundary, stronger safety invariants, deterministic verification, and a real Razorpay Test Mode execution path.

---

# 1. The failure

The first serious signal came from the deterministic recovery benchmark.

The system was performing dramatically worse than the fixed retry baseline.

## Build-log marker — 02:14

### Recovery benchmark falls to 1.95%

RECLAIM was recovering substantially less than the fixed retry baseline.

That immediately raised a more important question than:

> "Why is the number low?"

The question became:

> **"Which part of the recovery lifecycle caused the system to make worse decisions?"**

Because the benchmark was deterministic, we could reproduce the failure instead of debugging against an unstable live population.

That gave us a controlled environment for tracing the problem.

---

# 2. Trace the decision path

A recovery result was not treated as a single number.

We traced the lifecycle:

```text
Failed Payment
      ↓
Failure Taxonomy
      ↓
Candidate Actions
      ↓
AI Recommendation
      ↓
Guardrails
      ↓
Execution Boundary
      ↓
Recovery Outcome
```

The trace showed that the issue was not simply the final retry timing.

The candidate action space and recovery lifecycle were not being enforced as cleanly as they needed to be.

## Build-log marker — 02:27

### Trace reveals a policy mismatch

The candidate actions were not completely aligned with the hard failure taxonomy.

That was a dangerous class of bug because the model should never be asked to solve a problem that policy has not already constrained.

The correct relationship is:

```text
Failure taxonomy
      ↓
Policy
      ↓
Allowed candidate actions
      ↓
AI chooses
```

not:

```text
Failure
      ↓
AI invents a strategy
```

---

# 3. The first architectural correction

The recovery engine was moved to a more explicit multi-step lifecycle.

The policy engine became responsible for constructing the candidate set.

The AI provider could then select an intervention only from that set.

Conceptually:

```text
Payment
   ↓
Taxonomy
   ↓
Closed Candidate Set
   ↓
AI Recommendation
   ↓
Deterministic Guardrails
   ↓
Execution
```

This produced a much stronger architectural guarantee:

> **AI can optimize the decision without expanding the authority of the system.**

That distinction became one of the central principles of RECLAIM.

---

# 4. The recovery lifecycle was corrected

## Build-log marker — 03:06

### Recovery lifecycle corrected

The benchmark was moved onto the multi-step recovery runner and candidate containment was enforced.

The recovery runner became the orchestration point for:

- failure-aware intervention selection
- deterministic fallback behavior
- scheduling
- reconciliation
- decision construction
- guardrail evaluation
- execution-boundary handling
- audit recording

This made the recovery lifecycle explicit instead of letting behavior emerge from scattered conditions.

---

# 5. Then the interface broke

Once the recovery lifecycle was behaving correctly, the web console exposed another class of failure.

The backend returned a structured response containing the actual recovery result inside a wrapper.

The UI expected the decision fields at a different level.

The result was a classic interface-contract failure:

```text
Backend:
{
  scenario,
  customerLabel,
  result: {
    candidates,
    intervention,
    ...
  }
}
```

while the UI was effectively trying to read:

```text
response.candidates
```

instead of:

```text
response.result.candidates
```

The recovery logic was valid.

The display layer was not consuming the contract correctly.

### Fix

The response type was made explicit and the UI was updated to consume the authoritative `result` payload.

That removed the runtime failure without weakening the backend contract.

---

# 6. The proof script was stale

The next problem appeared in the verification path.

The recovery implementation had evolved, but the proof script was still expecting an older response structure.

That created a subtle failure mode:

```text
System:
    correct

Verification:
    wrong contract
```

This matters in financial systems.

A test harness that validates the wrong shape can create false confidence.

### Fix

The proof script was rewritten around the current recovery response.

It now verifies the actual fields returned by the current recovery pipeline, including:

- payment identity
- decline classification
- candidate actions
- selected intervention
- decision source
- confidence
- guardrail outcome
- execution boundary
- recovery artifact
- audit trail

The lesson was simple:

> **Verification code must evolve with the system contract.**

---

# 7. AI needed a clearer boundary

Another issue appeared when AI-provider metadata was allowed to leak too deeply into the decision contract.

The system did not need provider-specific details to determine whether a recovery action was safe.

The important distinction was:

```text
Who suggested this?
```

versus:

```text
Who authorized this?
```

The architecture was tightened so that AI remains a recommendation source while policy and guardrails remain authoritative.

The decision model therefore keeps provenance explicit without allowing provider-specific fields to become part of the core authority contract.

The principle became:

```text
AI
  = recommendation

Policy
  = permitted action space

Guardrails
  = authorization boundary

Gateway
  = execution boundary
```

---

# 8. Reconciliation became a hard boundary

One of the most important safety paths emerged around gateway timeouts.

A timeout does not necessarily mean a transaction failed.

It can mean the merchant simply does not know what happened.

That creates a dangerous scenario:

```text
Unknown gateway state
      ↓
Blind retry
      ↓
Potential duplicate charge
```

RECLAIM instead treats the unknown state as a reconciliation problem:

```text
Gateway timeout
      ↓
STOP NEW CHARGE
      ↓
Reconcile
      ↓
Captured?
   ├── Yes → Stop
   ├── Failed → Reclassify
   └── Unknown → Remain conservative
```

This moved reconciliation from being an optional utility into being a safety property of the recovery lifecycle.

---

# 9. Deterministic safety became executable

At this point, safety claims were converted into executable assertions.

The adversarial proof suite verifies that:

```text
✓ candidate actions remain inside the taxonomy
✓ AI cannot widen the action space
✓ invalid AI confidence is rejected
✓ non-charge decisions cannot reach the gateway
✓ open disputes block money movement
✓ risk blocks cannot be bypassed through another rail
✓ attempt ceilings cannot be exceeded
✓ gateway timeouts require reconciliation
✓ mandate ceilings protect authorization boundaries
```

These are important because they do not depend on a model saying:

> "I will behave safely."

The system checks the boundary in code.

---

# 10. The benchmark recovered

After the recovery lifecycle and candidate containment were corrected, the benchmark was re-run.

## Build-log marker — 03:32

### Recovery reaches 18.51%

The corrected system recovered:

```text
₹1,09,029.50
```

with:

```text
83 charge attempts
```

The final benchmark comparison showed:

| Metric | Fixed Retry Baseline | RECLAIM |
|---|---:|---:|
| Recovery rate | 15.50% | **18.51%** |
| Recovered | ₹91,285.00 | **₹1,09,029.50** |
| Charge attempts | 117 | **83** |

That corresponds to:

```text
+19.44% relative recovery improvement
```

and:

```text
34 fewer charge attempts
```

The benchmark is deterministic and seeded, so the comparison is reproducible rather than dependent on an uncontrolled live payment population.

---

# 11. The system was then proved independently

A separate deterministic proof run was used to validate the recovery engine itself.

The run covered:

```text
100 payments
177 decisions
92 attempts
```

and recovered:

```text
₹37,985.50
```

with:

```text
0 AI fallbacks
```

This proof run was deliberately kept separate from the benchmark comparison.

The benchmark answers:

> **"Does the recovery strategy improve the measured outcome?"**

The proof run answers:

> **"Does the recovery engine continue to respect its safety and decision invariants?"**

Those are different questions.

---

# 12. The UI exposed another contract mismatch

The same engineering process exposed several smaller but important interface issues.

The Recovery Console initially attempted to access decision fields before correctly narrowing the response structure.

The audit trail also required explicit narrowing before reading the last audit event.

These issues were addressed by making the data flow explicit rather than forcing the type system to accept assumptions.

The final result is a cleaner distinction between:

```text
loading
↓
error
↓
valid recovery response
```

and between:

```text
empty audit trail
↓
non-empty audit trail
```

That may look small, but these boundaries are exactly where production systems tend to become fragile.

---

# 13. The visual layer needed to catch up

The engineering work was not limited to backend logic.

As the recovery system changed, the UI components and styles also drifted.

We corrected several presentation-layer issues:

- recovery demo component/class mismatches
- recovery console alignment
- benchmark anchor spacing
- audit ledger filter/button alignment
- decision-trace layout
- responsive section sizing

The goal was not simply to make the application "look good."

The interface had to expose the system's actual architecture.

The final console makes the following visible:

```text
Payment
   ↓
Failure
   ↓
Candidate set
   ↓
AI recommendation
   ↓
Guardrails
   ↓
Execution boundary
   ↓
Audit
```

That is intentional.

A financial automation system should be inspectable.

---

# 14. Real Razorpay integration

After the deterministic and safety paths were stable, the next step was to prove the gateway integration.

RECLAIM was connected to Razorpay Test Mode.

The integration was verified through the real Razorpay API path.

The sequence included:

```text
API authentication
        ↓
Test Mode order creation
        ↓
Razorpay Checkout
        ↓
Payment verification
        ↓
Failed payment retrieval
        ↓
Webhook ingestion
        ↓
Recovery evaluation
        ↓
Recovery link creation
        ↓
Audit recording
```

The webhook path also validates the Razorpay signature before accepting the event.

Unsigned requests are rejected.

Duplicate webhook events are handled through event identity protection.

---

# 15. The real recovery proof

The final gateway proof used an actual Razorpay Test Mode failed payment.

The system retrieved the authoritative Razorpay payment state and classified the failure.

The policy layer produced a constrained candidate set.

The bounded AI provider selected an action from that set.

The deterministic guardrails evaluated the decision.

Because the recovery action required customer participation, RECLAIM generated a Razorpay Payment Link rather than blindly charging the payment server-side.

The final flow was:

```text
Real Razorpay failed payment
          ↓
Authoritative payment state
          ↓
Failure taxonomy
          ↓
Policy candidate set
          ↓
AI recommendation
          ↓
Deterministic guardrails
          ↓
Customer-action recovery link
          ↓
Audit ledger
```

The proof completed successfully.

```text
REAL RECOVERY PROOF PASSED
```

---

# 16. What the final system guarantees

The debugging process led to a much stronger architecture than the original implementation.

RECLAIM now has explicit boundaries for:

### Decision

The AI can recommend an intervention.

### Policy

The system decides which interventions are even available.

### Safety

Guardrails can reject an otherwise valid AI recommendation.

### Reconciliation

Ambiguous payment states are resolved before another charge is attempted.

### Execution

The gateway is reached only after the decision passes the execution boundary.

### Auditability

The recovery trail is recorded so that the decision can be inspected afterward.

The resulting control model is:

```text
             AI
          RECOMMENDS
              │
              ▼
           POLICY
          CONSTRAINS
              │
              ▼
        GUARDRAILS
          AUTHORIZE
              │
              ▼
          GATEWAY
          EXECUTES
              │
              ▼
           AUDIT
         RECORDS ALL
```

---

# 17. What we learned

The biggest lesson from the build was that the hardest part was not integrating AI.

It was deciding where AI should **stop**.

A payment recovery system is a particularly useful environment for this distinction because the cost of an incorrect decision is not just a bad recommendation.

It can be:

- another unnecessary attempt
- a duplicate charge
- an unauthorized action
- a customer-contact violation
- a broken mandate boundary
- a recovery decision that cannot be explained later

So the design principle became:

> **Do not ask AI to understand constraints that deterministic code can enforce.**

Let AI optimize inside a known boundary.

---

# 18. Final engineering loop

The complete development path can be summarized as:

```text
1. Measure
   ↓
2. Observe a severe benchmark regression
   ↓
3. Trace the recovery lifecycle
   ↓
4. Find policy/candidate containment issues
   ↓
5. Correct the recovery runner
   ↓
6. Tighten the AI boundary
   ↓
7. Make reconciliation mandatory for ambiguity
   ↓
8. Fix API/UI response contracts
   ↓
9. Fix stale verification tooling
   ↓
10. Turn safety requirements into executable proofs
   ↓
11. Re-run deterministic benchmark
   ↓
12. Validate real Razorpay Test Mode integration
   ↓
13. Produce a real recovery artifact
   ↓
14. Record the audit trail
   ↓
15. Prove the final system
```

That process is the reason the final architecture looks the way it does.

---

# 19. The result

RECLAIM ended up being more than a payment retry engine.

It became a control plane for payment recovery in which:

```text
AI recommends.
Policy constrains.
Guardrails authorize.
Razorpay executes.
Audit explains.
```

The final system combines:

- adaptive recovery strategies
- deterministic policy
- bounded AI
- reconciliation-first handling
- adversarial safety proofs
- deterministic benchmarking
- a real Razorpay Test Mode integration
- customer-action recovery
- auditable execution

The benchmark improvement is useful.

The more important result is that the system can explain **why** the recovery action was considered, **which actions were allowed**, **whether guardrails authorized it**, and **what actually reached the gateway**.

---

# 20. Final takeaway

The most valuable output from the late-night debugging session was not a single percentage.

It was a boundary.

```text
                ┌───────────────────────┐
                │         AI            │
                │    Recommendation     │
                └──────────┬────────────┘
                           │
                           ▼
                ┌───────────────────────┐
                │        POLICY         │
                │    Allowed actions   │
                └──────────┬────────────┘
                           │
                           ▼
                ┌───────────────────────┐
                │      GUARDRAILS       │
                │   Safety + limits     │
                └──────────┬────────────┘
                           │
                           ▼
                ┌───────────────────────┐
                │       GATEWAY         │
                │ Authorized execution  │
                └──────────┬────────────┘
                           │
                           ▼
                ┌───────────────────────┐
                │        AUDIT          │
                │ Reconstruct the path │
                └───────────────────────┘
```

That is the core engineering idea behind RECLAIM.

**The model gets to recommend.  
The system gets to decide.**

---

## Buildathon context

**Project:** RECLAIM  
**Track:** Razorpay Buildathon — Track 03: AI Revenue Recovery  
**Integration:** Razorpay Test Mode  
**Primary architecture:** Next.js + TypeScript + deterministic policy/guardrails + Razorpay gateway adapter  
**Core principle:** bounded AI inside a deterministic financial control plane

---

> **Measure it. Trace it. Fix it. Re-run it.**
>
> That is how RECLAIM got from a broken benchmark to a provable recovery system.