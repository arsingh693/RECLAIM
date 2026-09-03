# RECLAIM

### Autonomous Payment Recovery Control Plane

RECLAIM is an event-driven payment recovery engine for Razorpay.

It combines:

- deterministic failure taxonomy
- policy-constrained recovery actions
- bounded AI recommendations
- deterministic guardrails
- payment-state reconciliation
- customer-authorized Razorpay recovery
- inspectable recovery events
- deterministic benchmark and safety proofs

The core principle is:

> **AI recommends. Policy constrains. Guardrails decide.**

---

## Why RECLAIM

A failed payment should not trigger the same retry strategy every time.

RECLAIM treats recovery as a decision problem.

Instead of:

```text
payment failed
    ↓
retry
    ↓
retry
    ↓
retry