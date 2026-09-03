# RECLAIM Architecture

## A bounded AI control plane for payment recovery

RECLAIM is designed as an event-driven payment recovery control plane.

Its central architectural rule is:

> **AI may recommend a recovery action, but deterministic policy and guardrails retain authority over what is permitted and what can reach the payment gateway.**

The system is deliberately split into layers so that optimization, policy, safety, execution, and observability remain independently understandable.

---

# 1. System overview

![RECLAIM Architecture](reclaim-architecture.png)

```text
                         ┌──────────────────────┐
                         │       RAZORPAY       │
                         │                      │
                         │ payments / webhooks  │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │      INGESTION       │
                         │                      │
                         │ webhook verification│
                         │ event identity       │
                         │ authoritative fetch │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │   PAYMENT CONTEXT    │
                         │                      │
                         │ payment state       │
                         │ failure reason      │
                         │ customer context    │
                         │ attempt history     │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │   FAILURE TAXONOMY   │
                         │                      │
                         │ decline classification
                         │ risk / mandate state │
                         │ ambiguity detection  │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │     POLICY ENGINE    │
                         │                      │
                         │ closed action space  │
                         │ retry ceilings       │
                         │ eligibility rules    │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │    BOUNDED AI        │
                         │                      │
                         │ choose one permitted │
                         │ intervention         │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │   DETERMINISTIC      │
                         │     GUARDRAILS       │
                         │                      │
                         │ risk / disputes     │
                         │ attempts / mandate  │
                         │ reconciliation      │
                         └──────────┬───────────┘
                                    │
                        ┌───────────┴───────────┐
                        │                       │
                        ▼                       ▼
              ┌──────────────────┐    ┌──────────────────┐
              │   AUTHORIZED     │    │     BLOCKED      │
              │ execution path   │    │ stop / escalate  │
              └────────┬─────────┘    └──────────────────┘
                       │
                       ▼
              ┌──────────────────┐
              │ RAZORPAY GATEWAY │
              │                  │
              │ customer-action  │
              │ recovery path    │
              └──────────────────┘
                       │
                       ▼
              ┌──────────────────┐
              │    AUDIT LEDGER  │
              │                  │
              │ decision + event │
              │ execution trace  │
              └──────────────────┘
```

---

# 2. Architectural principles

RECLAIM follows six core principles.

## 2.1 AI is bounded

The model never receives an unconstrained instruction such as:

```text
"Figure out how to recover this payment."
```

Instead, it receives a policy-approved action set.

For example:

```text
[
  "RETRY_SCHEDULED",
  "RETRY_ALTERNATE_RAIL",
  "ESCALATE_HUMAN",
  "STOP_PERMANENT"
]
```

The model can choose from those actions.

It cannot introduce:

```text
"TRY_SOMETHING_ELSE"
```

because that action does not exist in the policy contract.

---

## 2.2 Policy is deterministic

The policy engine owns eligibility.

It determines which interventions are valid for the payment's failure state.

Policy is therefore the first control boundary between payment state and AI.

```text
payment
  ↓
failure taxonomy
  ↓
policy
  ↓
allowed actions
  ↓
AI
```

---

## 2.3 Guardrails are authoritative

Even a policy-valid AI recommendation can still be rejected.

Example:

```text
AI recommends:
RETRY_SCHEDULED
```

but:

```text
attempt ceiling already reached
```

The guardrail layer wins.

The result becomes:

```text
BLOCKED
```

This is important because the AI does not control authorization.

---

## 2.4 Ambiguity is not failure

A payment timeout is not automatically treated as a failed payment.

The system distinguishes:

```text
FAILED
CAPTURED
PENDING
UNKNOWN
```

When state is unknown, reconciliation takes priority over another charge attempt.

---

## 2.5 Execution is separated from recommendation

The recovery decision is represented as a decision object.

Execution is a separate concern.

This means:

```text
recommendation
      ≠
authorization
      ≠
gateway execution
```

The separation makes the system easier to test and safer to extend.

---

## 2.6 Audit is part of the architecture

Every meaningful recovery transition should leave enough evidence to reconstruct:

```text
what happened
why it happened
what was allowed
what the model selected
whether guardrails approved it
what reached the gateway
```

The audit layer is therefore not merely logging.

It is part of the control plane.

---

# 3. Request lifecycle

A single failed payment passes through the following lifecycle.

```text
1. Gateway event / authoritative payment state
                    ↓
2. Normalize payment context
                    ↓
3. Classify decline
                    ↓
4. Generate policy candidate set
                    ↓
5. Ask bounded decision provider
                    ↓
6. Construct decision
                    ↓
7. Evaluate deterministic guardrails
                    ↓
8. Execute only if authorized
                    ↓
9. Record audit events
```

Each stage has a specific responsibility.

---

# 4. Razorpay ingestion

RECLAIM supports Razorpay as the real gateway provider.

The integration has two important entry paths.

## 4.1 Webhook path

Razorpay can notify RECLAIM about payment events.

The webhook endpoint:

```text
POST /api/razorpay/webhook
```

performs signature verification before accepting the payload.

The event identity is also used to protect against duplicate processing.

Conceptually:

```text
Razorpay
   │
   ▼
Webhook
   │
   ├── signature invalid → reject
   │
   └── signature valid
          │
          ▼
       event ID
          │
          ▼
       process once
```

---

## 4.2 Authoritative payment retrieval

The recovery path does not rely only on an event payload.

For a real recovery evaluation, RECLAIM retrieves the authoritative Razorpay payment state.

That provides the system with:

- payment ID
- payment status
- amount
- currency
- failure reason
- payment method
- gateway metadata

The system then translates that information into the internal domain model.

---

# 5. Domain normalization

Gateway-specific representations are not allowed to leak throughout the entire application.

Instead, Razorpay data is normalized into the RECLAIM domain model.

Conceptually:

```text
Razorpay Payment
      ↓
FailedPayment
      ↓
Recovery pipeline
```

A normalized payment contains information such as:

```text
id
merchantId
chargeKind
amountPaise
currency
method
declineCode
gatewayRawReason
failedAt
attemptsSoFar
customer
mandateCeilingPaise
```

This gives the recovery engine a stable internal contract.

---

# 6. Failure taxonomy

The taxonomy maps raw gateway failure information into explicit RECLAIM decline states.

Examples include:

```text
CARD_EXPIRED
CARD_BLOCKED
INVALID_INSTRUMENT
AUTHENTICATION_FAILED
RISK_BLOCKED
DO_NOT_HONOUR
MANDATE_PAUSED
MANDATE_LIMIT_EXCEEDED
INSUFFICIENT_FUNDS
ISSUER_UNAVAILABLE
LIMIT_EXCEEDED
```

The important architectural property is that the taxonomy is deterministic.

A language model does not decide:

```text
"Maybe this looks like insufficient funds."
```

The application classifies the failure first.

The AI only acts after the failure state has been established.

---

# 7. Policy engine

The policy engine converts a normalized payment into a closed set of candidate interventions.

Conceptually:

```text
getCandidateActions(payment)
```

returns something like:

```text
[
  RETRY_SCHEDULED,
  RETRY_ALTERNATE_RAIL,
  ESCALATE_HUMAN,
  STOP_PERMANENT
]
```

The candidate list depends on the failure class and system state.

This is the most important boundary before AI.

---

# 8. Closed action space

The action catalog is intentionally finite.

A recovery intervention can represent actions such as:

```text
RETRY_NOW
RETRY_SCHEDULED
RETRY_ALTERNATE_RAIL
RETRY_SPLIT_AMOUNT
NUDGE_THEN_RETRY
REQUEST_INSTRUMENT_UPDATE
REQUEST_REAUTHORIZATION
RECONCILE_THEN_DECIDE
ESCALATE_HUMAN
STOP_PERMANENT
```

Not every payment receives every action.

The taxonomy and policy engine determine eligibility.

Therefore:

```text
global action catalog
        ↓
payment-specific policy
        ↓
candidate subset
```

The AI only sees the subset.

---

# 9. AI provider boundary

The decision provider receives structured input containing:

```text
payment context
+
candidate actions
+
fallback intervention
```

The expected result is structured.

Conceptually:

```text
AgentDecisionResult
├── intervention
├── confidence
└── reasoning
```

The provider abstraction allows the system to swap the decision implementation without changing the policy architecture.

The current demo uses a deterministic development provider for reproducibility.

That provider is deliberately boring.

That is a feature.

For benchmark and proof runs, deterministic behavior makes failures reproducible and makes changes measurable.

---

# 10. Decision construction

The orchestration layer converts the provider response into a normalized decision.

A decision contains information such as:

```text
paymentId
intervention
scheduledFor
switchToMethod
splitAmountPaise
reasoning
rejectedAlternatives
source
decidedAt
```

The decision object does not itself guarantee authorization.

It still has to pass the guardrail layer.

---

# 11. Guardrail layer

Guardrails enforce constraints independently from the AI provider.

Typical checks include:

```text
attempt ceilings
risk restrictions
open disputes
mandate limits
customer-contact rules
reconciliation requirements
action/money-movement boundaries
```

Conceptually:

```text
AI decision
    ↓
evaluateGuardrails()
    ↓
┌───────────────────┐
│ allowed?          │
├───────────────────┤
│ yes → execute     │
│ no  → stop/escalate
└───────────────────┘
```

This provides a second deterministic verification boundary after AI.

---

# 12. Reconciliation-first design

Gateway ambiguity deserves its own architecture.

Suppose a charge request times out.

The system cannot safely conclude:

```text
payment = failed
```

Instead:

```text
payment = unknown
```

The recovery lifecycle then requires reconciliation.

```text
                timeout
                   ↓
             ┌───────────┐
             │ reconcile │
             └─────┬─────┘
                   │
       ┌───────────┼───────────┐
       ▼           ▼           ▼
   captured      failed      unknown
       │           │           │
       ▼           ▼           ▼
      stop       re-decide   remain
                            conservative
```

This is one of the most important protections against accidental duplicate charges.

---

# 13. Gateway abstraction

RECLAIM does not couple the recovery engine directly to a single gateway implementation.

The abstraction is conceptually:

```text
PaymentGateway
├── charge()
├── reconcile()
└── createRecoveryLink()
```

Implementations include:

```text
PaymentGateway
├── SimulatedGateway
└── RazorpayGateway
```

---

# 14. Simulated gateway

The simulated gateway exists to make the system measurable.

Its primary responsibilities are:

- deterministic outcomes
- controlled failure conditions
- reproducible attempts
- benchmark execution
- safety proof execution

A fixed seed can therefore reproduce the same payment population and the same recovery run.

---

# 15. Razorpay gateway

The Razorpay gateway is the real integration boundary.

It is responsible for gateway-specific behavior such as:

- authenticated API requests
- payment state retrieval
- reconciliation
- recovery artifact creation

The rest of the recovery engine works against the abstract gateway interface.

This keeps payment-provider concerns isolated.

---

# 16. Execution boundary

A key RECLAIM design choice is to avoid treating an AI recommendation as a direct command to charge money.

The flow is:

```text
AI recommendation
        ↓
policy validity
        ↓
guardrail authorization
        ↓
execution boundary
        ↓
gateway
```

In the current Razorpay integration, the demonstrated customer-facing recovery path uses a Razorpay Payment Link.

That creates:

```text
server-side decision
        ↓
customer-action artifact
        ↓
customer completes recovery
```

rather than an unrestricted autonomous server-side card re-charge.

---

# 17. Why the execution boundary matters

There are three separate states:

### Recommended

The AI selected the intervention.

### Authorized

Deterministic guardrails allowed it.

### Executed

The gateway accepted an authorized operation.

These states should never be conflated.

A decision can be:

```text
recommended = yes
authorized = no
executed = no
```

That is a valid and useful outcome.

It means the system behaved safely.

---

# 18. Audit ledger

The audit ledger records important recovery transitions.

Typical events include:

```text
RECOVERY_EVALUATED
RECOVERY_BLOCKED
RECOVERY_LINK_CREATED
RECOVERY_LINK_FAILED
```

A simplified event model is:

```text
event
├── event identity
├── payment identity
├── event type
├── timestamp
├── decision context
├── guardrail outcome
└── execution metadata
```

The goal is to make a recovery decision reconstructable.

---

# 19. Idempotency and event safety

Payment systems routinely receive duplicated or delayed events.

RECLAIM therefore treats event identity and idempotency as architectural concerns.

For webhook ingestion:

```text
event ID
   ↓
duplicate check
   ↓
already processed?
   ├── yes → ignore safely
   └── no  → process
```

For gateway actions, idempotency keys are maintained at the gateway boundary where supported by the execution path.

This prevents retries at the application layer from accidentally becoming duplicate gateway operations.

---

# 20. Customer context

Recovery should not depend only on the current payment.

The domain model can carry customer context such as:

```text
customerId
timezone
availableMethods
successfulChargesLifetime
consecutiveFailures
historicalPaydayHint
contactOptOut
hasOpenDispute
```

This creates a foundation for future adaptive recovery.

For example:

```text
same failure
+
different customer context
=
potentially different safe intervention
```

The system can evolve from failure-only logic toward context-aware recovery without changing the safety architecture.

---

# 21. Benchmark architecture

The benchmark is intentionally separate from the live gateway.

```text
Seeded payment population
          ↓
   ┌───────────────┐
   │ Fixed Retry   │
   └───────────────┘
          vs.
   ┌───────────────┐
   │    RECLAIM    │
   └───────────────┘
          ↓
      same metrics
          ↓
    reproducible result
```

The benchmark measures:

- recovery rate
- recovered amount
- charge attempts
- relative improvement

Because the payment population is deterministic, changes to the recovery engine can be compared consistently.

---

# 22. Safety proof architecture

The proof layer tests system invariants rather than individual happy paths.

Examples:

```text
candidate containment
AI boundary enforcement
confidence validation
gateway isolation
open-dispute protection
risk isolation
attempt ceilings
timeout reconciliation
mandate ceilings
```

The proof pipeline is conceptually:

```text
Generate controlled payment state
          ↓
Run recovery decision
          ↓
Assert invariant
          ↓
Pass / fail
```

This enables adversarial testing.

Instead of asking:

> "Did the normal demo work?"

we ask:

> "Can the system be tricked into violating its safety boundary?"

---

# 23. Deterministic proof

The final deterministic proof run used:

```text
100 payments
177 decisions
92 attempts
```

and produced:

```text
₹37,985.50 recovered
0 AI fallbacks
```

The proof is intentionally separate from the performance benchmark.

Benchmark:

```text
measure outcome
```

Proof:

```text
verify invariants
```

---

# 24. Real Razorpay recovery proof

The real integration follows this path:

```text
Razorpay failed payment
        ↓
authoritative payment lookup
        ↓
failure taxonomy
        ↓
candidate actions
        ↓
bounded decision
        ↓
guardrails
        ↓
recovery link
        ↓
audit
```

This proves that the architecture survives contact with an actual payment provider rather than existing only inside the simulator.

---

# 25. API surface

The Next.js application exposes the recovery system through API routes.

Conceptually:

```text
/api/recovery-demo
```

drives deterministic demonstration scenarios.

Razorpay-related routes include:

```text
/api/razorpay/health
/api/razorpay/order
/api/razorpay/verify
/api/razorpay/webhook
```

and recovery/audit endpoints used by the operational console.

The application keeps these gateway boundaries behind server-side routes rather than exposing secrets to the browser.

---

# 26. Security model

Razorpay credentials are server-side configuration.

The browser may receive the public key needed for Checkout.

Secret values remain server-side:

```text
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
```

The webhook secret is used to validate incoming Razorpay events.

The key principle is:

```text
public payment-facing identifier
        ≠
server authentication secret
```

---

# 27. Frontend architecture

The frontend is not merely a marketing page.

It acts as an operational view of the recovery engine.

Major UI areas include:

```text
Overview
Engine
Benchmark
Safety
Proof
```

Operational components expose:

```text
RecoveryDemo
RealRecoveryConsole
AuditLedger
SystemProofPanel
RazorpayCheckout
```

The interface is designed to show the decision lifecycle directly.

---

# 28. Recovery Console architecture

The real recovery console follows:

```text
payment ID input
      ↓
Razorpay authoritative lookup
      ↓
RECLAIM evaluation
      ↓
decision result
      ↓
guardrail result
      ↓
recovery artifact
      ↓
audit trail
```

The operator can therefore see the relationship between the payment and the recovery decision.

---

# 29. Audit Console architecture

The ledger provides an operational view over recovery events.

A typical flow is:

```text
Recovery evaluation
      ↓
event persisted
      ↓
ledger refresh
      ↓
operator inspection
```

The ledger is intentionally human-readable.

This is important when a judge, operator, or developer needs to answer:

> "Why did RECLAIM make this decision?"

---

# 30. Failure-safe behavior

The system prefers conservative outcomes when uncertainty exists.

Examples:

```text
unknown gateway state
        → reconcile

risk restriction
        → stop / escalate

mandate ceiling
        → block

open dispute
        → block money movement

invalid AI output
        → reject / fallback

attempt ceiling
        → stop
```

The system therefore optimizes within the space of safe actions instead of maximizing action count.

---

# 31. Why the architecture is extensible

The control-plane model makes future changes localized.

A new AI provider changes:

```text
AI provider layer
```

A new gateway changes:

```text
gateway adapter
```

A new recovery rule changes:

```text
policy layer
```

A new safety invariant changes:

```text
guardrail / proof layer
```

A new operational view changes:

```text
frontend / audit console
```

The core authority boundaries remain stable.

---

# 32. Production evolution

The current build is intentionally scoped as a Buildathon implementation.

A production evolution would add:

```text
durable event storage
        ↓
distributed workflow execution
        ↓
queue-backed retries
        ↓
persistent audit storage
        ↓
model observability
        ↓
merchant policy configuration
        ↓
production-grade idempotency
        ↓
metrics / alerts / SLOs
```

None of those additions require giving unrestricted authority to the AI layer.

The core architecture remains:

```text
AI
 ↓
policy
 ↓
guardrails
 ↓
execution
 ↓
audit
```

---

# 33. Current execution model

The current implementation intentionally distinguishes between:

### Simulation

Used for:

- benchmarks
- deterministic proof
- repeatable scenarios

### Razorpay Test Mode

Used for:

- real API authentication
- actual payment state retrieval
- real webhook ingestion
- payment verification
- actual recovery-link creation

This gives RECLAIM both:

```text
reproducibility
```

and:

```text
real gateway integration
```

without pretending that a deterministic simulator is a production payment gateway.

---

# 34. The central design decision

The entire architecture can be reduced to one rule:

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
          RECORDS
```

The AI is useful because it can make context-sensitive recommendations.

The deterministic system is necessary because money-moving operations need explicit authority boundaries.

---

# 35. Summary

RECLAIM is an event-driven payment recovery control plane with:

- Razorpay integration
- explicit failure taxonomy
- closed recovery action space
- bounded AI recommendation
- deterministic guardrails
- reconciliation-first handling
- gateway abstraction
- deterministic simulator
- adversarial safety proofs
- recovery operations console
- audit ledger
- customer-action recovery
- reproducible benchmarking

The resulting architecture is intentionally conservative at the execution boundary.

It is designed around the principle:

> **Optimize recovery decisions without allowing AI to become the authority over money.**