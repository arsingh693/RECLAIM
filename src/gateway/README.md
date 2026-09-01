# Gateway Layer

The gateway layer isolates payment-provider mechanics from RECLAIM's domain and policy logic.

- `types.ts` — provider-independent gateway contract.
- `simulator.ts` — deterministic, seeded, idempotent benchmark gateway.
- `razorpay.ts` — thin REST adapter for provider-supported reconciliation and customer-facing collection primitives.

The benchmark **must** use the simulator. It is the reproducible measurement environment for comparing the fixed baseline with RECLAIM's policy. The Razorpay adapter is the integration path, not the source of benchmark numbers.
