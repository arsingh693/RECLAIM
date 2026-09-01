import assert from "node:assert/strict";

import {
  generateSeedBatch,
  SEED_BATCH_DEFAULTS,
  validateSeedBatch,
} from "../src/data/seedBatch";

const first =
  generateSeedBatch(
    SEED_BATCH_DEFAULTS,
  );

const second =
  generateSeedBatch(
    SEED_BATCH_DEFAULTS,
  );

validateSeedBatch(first);
validateSeedBatch(second);

/**
 * Most important benchmark invariant:
 *
 * Same configuration must produce
 * exactly the same dataset.
 */
assert.deepEqual(
  first,
  second,
  "same seed/config must produce byte-for-byte equivalent data",
);

assert.equal(
  first.payments.length,
  SEED_BATCH_DEFAULTS.size,
);

assert.ok(
  first.payments.some(
    (p) =>
      p.declineCode ===
      "GATEWAY_TIMEOUT",
  ),
);

assert.ok(
  first.payments.some(
    (p) =>
      p.declineCode ===
      "INSUFFICIENT_FUNDS",
  ),
);

assert.ok(
  first.payments.some(
    (p) =>
      p.declineCode ===
      "MANDATE_LIMIT_EXCEEDED",
  ),
);

assert.ok(
  first.payments.some(
    (p) =>
      p.customer.contactOptOut,
  ),
);

assert.ok(
  first.payments.some(
    (p) =>
      p.customer.hasOpenDispute,
  ),
);

assert.ok(
  first.payments.some(
    (p) =>
      p.customer.availableMethods.length >
      1,
  ),
);

assert.ok(
  first.payments.some(
    (p) =>
      p.customer.availableMethods.length ===
      1,
  ),
);

assert.ok(
  first.payments.some(
    (p) =>
      p.mandateCeilingPaise !== null &&
      p.amountPaise >
        p.mandateCeilingPaise,
  ),
);

console.log(
  "✓ seed invariants hold — deterministic, mixed, constraint-aware batch",
);