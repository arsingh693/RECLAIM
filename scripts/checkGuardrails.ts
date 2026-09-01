import {
  evaluateGuardrails,
  consumesChargeAttempt,
  contactsCustomer,
} from "../src/policy/guardrails";

import { getDeclineProfile } from "../src/domain/declineCodes";

import type {
  Decision,
  FailedPayment,
  Intervention,
} from "../src/domain/types";

const BASE_PAYMENT: FailedPayment = {
  id: "pay_guardrail_001",
  merchantId: "merchant_test",
  amountPaise: 49900,
  currency: "INR",
  method: "card",
  chargeKind: "one_time",
  declineCode: "INSUFFICIENT_FUNDS",
  gatewayRawReason: "insufficient funds",
  failedAt: "2026-08-31T10:00:00.000Z",
  attemptsSoFar: 0,
  customer: {
    customerId: "customer_test",
    successfulChargesLifetime: 12,
    consecutiveFailures: 1,
    availableMethods: ["card", "upi"],
    historicalPaydayHint: 1,
    contactOptOut: false,
    hasOpenDispute: false,
    timezone: "Asia/Kolkata",
  },
  mandateCeilingPaise: null,
};

function makeDecision(
  intervention: Intervention,
  overrides: Partial<Decision> = {},
): Decision {
  return {
    paymentId: BASE_PAYMENT.id,
    intervention,
    scheduledFor:
      intervention === "RETRY_SCHEDULED"
        ? "2026-09-01T10:00:00.000Z"
        : null,
    switchToMethod:
      intervention === "RETRY_ALTERNATE_RAIL"
        ? "upi"
        : null,
    splitAmountPaise:
      intervention === "RETRY_SPLIT_AMOUNT"
        ? 25000
        : null,
    reasoning: "test decision",
    rejectedAlternatives: [],
    source: "fallback",
    decidedAt: "2026-08-31T10:00:00.000Z",
    ...overrides,
  };
}

function assert(
  condition: boolean,
  message: string,
): void {
  if (!condition) {
    throw new Error(message);
  }
}

/* -------------------------------------------------------------------------- */
/* Classification invariants                                                  */
/* -------------------------------------------------------------------------- */

assert(
  consumesChargeAttempt("RETRY_NOW"),
  "RETRY_NOW should consume an attempt",
);

assert(
  consumesChargeAttempt("RETRY_SCHEDULED"),
  "RETRY_SCHEDULED should consume an attempt",
);

assert(
  consumesChargeAttempt("RETRY_ALTERNATE_RAIL"),
  "RETRY_ALTERNATE_RAIL should consume an attempt",
);

assert(
  consumesChargeAttempt("RETRY_SPLIT_AMOUNT"),
  "RETRY_SPLIT_AMOUNT should consume an attempt",
);

assert(
  consumesChargeAttempt("NUDGE_THEN_RETRY"),
  "NUDGE_THEN_RETRY should consume an attempt",
);

assert(
  !consumesChargeAttempt("REQUEST_INSTRUMENT_UPDATE"),
  "REQUEST_INSTRUMENT_UPDATE must not consume an attempt",
);

assert(
  !consumesChargeAttempt("REQUEST_REAUTHORIZATION"),
  "REQUEST_REAUTHORIZATION must not consume an attempt",
);

assert(
  !consumesChargeAttempt("RECONCILE_THEN_DECIDE"),
  "RECONCILE_THEN_DECIDE must not consume an attempt",
);

assert(
  !consumesChargeAttempt("ESCALATE_HUMAN"),
  "ESCALATE_HUMAN must not consume an attempt",
);

assert(
  !consumesChargeAttempt("STOP_PERMANENT"),
  "STOP_PERMANENT must not consume an attempt",
);

assert(
  contactsCustomer("REQUEST_INSTRUMENT_UPDATE"),
  "Instrument update should contact customer",
);

assert(
  contactsCustomer("REQUEST_REAUTHORIZATION"),
  "Reauthorization should contact customer",
);

assert(
  contactsCustomer("NUDGE_THEN_RETRY"),
  "Nudge should contact customer",
);

assert(
  !contactsCustomer("RETRY_NOW"),
  "RETRY_NOW should not contact customer",
);

/* -------------------------------------------------------------------------- */
/* Basic allowed decision                                                      */
/* -------------------------------------------------------------------------- */

{
  const decision = makeDecision("RETRY_SCHEDULED");

  const verdict = evaluateGuardrails(
    BASE_PAYMENT,
    decision,
  );

  assert(
    verdict.allowed,
    `Expected valid scheduled retry to be allowed: ${verdict.blockedBy.join(", ")}`,
  );
}

/* -------------------------------------------------------------------------- */
/* Attempt ceiling                                                             */
/* -------------------------------------------------------------------------- */

{
  const profile = getDeclineProfile(
    BASE_PAYMENT.declineCode,
  );

  const payment: FailedPayment = {
    ...BASE_PAYMENT,
    attemptsSoFar: profile.maxChargeAttempts,
  };

  const decision = makeDecision("RETRY_NOW");

  const verdict = evaluateGuardrails(
    payment,
    decision,
  );

  assert(
    !verdict.allowed,
    "Retry at the attempt ceiling must be blocked",
  );

  assert(
    verdict.blockedBy.includes(
      "ATTEMPT_CEILING",
    ),
    "Attempt ceiling violation must be explicit",
  );
}

/* -------------------------------------------------------------------------- */
/* Open dispute                                                                */
/* -------------------------------------------------------------------------- */

{
  const payment: FailedPayment = {
    ...BASE_PAYMENT,
    customer: {
      ...BASE_PAYMENT.customer,
      hasOpenDispute: true,
    },
  };

  const decision = makeDecision("RETRY_NOW");

  const verdict = evaluateGuardrails(
    payment,
    decision,
  );

  assert(
    !verdict.allowed,
    "Recovery during an open dispute must be blocked",
  );

  assert(
    verdict.blockedBy.includes("OPEN_DISPUTE"),
    "Open dispute must be an explicit blocking reason",
  );
}

/* -------------------------------------------------------------------------- */
/* Contact opt-out                                                             */
/* -------------------------------------------------------------------------- */

{
  const payment: FailedPayment = {
    ...BASE_PAYMENT,
    customer: {
      ...BASE_PAYMENT.customer,
      contactOptOut: true,
    },
  };

  const decision = makeDecision(
    "REQUEST_INSTRUMENT_UPDATE",
  );

  const verdict = evaluateGuardrails(
    payment,
    decision,
  );

  assert(
    !verdict.allowed,
    "Customer opt-out must block customer contact",
  );

  assert(
    verdict.blockedBy.includes(
      "CUSTOMER_CONTACT_OPT_OUT",
    ),
    "Opt-out must be explicit",
  );
}

/* -------------------------------------------------------------------------- */
/* Gateway timeout                                                             */
/* -------------------------------------------------------------------------- */

{
  const payment: FailedPayment = {
    ...BASE_PAYMENT,
    declineCode: "GATEWAY_TIMEOUT",
  };

  const retry = makeDecision("RETRY_NOW");

  const retryVerdict = evaluateGuardrails(
    payment,
    retry,
  );

  assert(
    !retryVerdict.allowed,
    "Timeout must never directly authorize a retry",
  );

  assert(
    retryVerdict.blockedBy.includes(
      "UNRECONCILED_GATEWAY_TIMEOUT",
    ),
    "Timeout retry must be explicitly blocked",
  );

  const reconcile = makeDecision(
    "RECONCILE_THEN_DECIDE",
  );

  const reconcileVerdict =
    evaluateGuardrails(
      payment,
      reconcile,
    );

  assert(
    reconcileVerdict.allowed,
    "Reconciliation should be allowed for a timeout",
  );
}

/* -------------------------------------------------------------------------- */
/* Alternate rail                                                              */
/* -------------------------------------------------------------------------- */

{
  const payment: FailedPayment = {
    ...BASE_PAYMENT,
    customer: {
      ...BASE_PAYMENT.customer,
      availableMethods: ["card"],
    },
  };

  const decision = makeDecision(
    "RETRY_ALTERNATE_RAIL",
    {
      switchToMethod: "upi",
    },
  );

  const verdict = evaluateGuardrails(
    payment,
    decision,
  );

  assert(
    !verdict.allowed,
    "Unavailable alternate rail must be blocked",
  );

}

/* -------------------------------------------------------------------------- */
/* Split amount                                                                */
/* -------------------------------------------------------------------------- */

{
  const decision = makeDecision(
    "RETRY_SPLIT_AMOUNT",
    {
      splitAmountPaise: BASE_PAYMENT.amountPaise,
    },
  );

  const verdict = evaluateGuardrails(
    BASE_PAYMENT,
    decision,
  );

  assert(
    !verdict.allowed,
    "A full amount is not a split",
  );

  assert(
    verdict.blockedBy.includes(
      "SPLIT_AMOUNT_NOT_A_SPLIT",
    ) ||
      verdict.blockedBy.includes(
        "INVALID_SPLIT_AMOUNT",
      ),
    "Invalid split amount must be blocked",
  );
}

/* -------------------------------------------------------------------------- */
/* Payment ID integrity                                                        */
/* -------------------------------------------------------------------------- */

{
  const decision = makeDecision(
    "RETRY_NOW",
    {
      paymentId: "pay_some_other_payment",
    },
  );

  const verdict = evaluateGuardrails(
    BASE_PAYMENT,
    decision,
  );

  assert(
    !verdict.allowed,
    "A decision for another payment must be blocked",
  );

  assert(
    verdict.blockedBy.includes(
      "PAYMENT_ID_MISMATCH",
    ),
    "Payment ID mismatch must be explicit",
  );
}

/* -------------------------------------------------------------------------- */
/* Mandate ceiling                                                             */
/* -------------------------------------------------------------------------- */

{
  const payment: FailedPayment = {
    ...BASE_PAYMENT,
    chargeKind: "subscription_renewal",
    mandateCeilingPaise: 30000,
  };

  const decision = makeDecision("RETRY_NOW");

  const verdict = evaluateGuardrails(
    payment,
    decision,
  );

  assert(
    !verdict.allowed,
    "A renewal above the mandate ceiling must be blocked",
  );

  assert(
    verdict.blockedBy.includes(
      "MANDATE_CEILING_EXCEEDED",
    ),
    "Mandate ceiling violation must be explicit",
  );
}

/* -------------------------------------------------------------------------- */
/* Missing mandate                                                             */
/* -------------------------------------------------------------------------- */

{
  const payment: FailedPayment = {
    ...BASE_PAYMENT,
    chargeKind: "subscription_renewal",
    mandateCeilingPaise: null,
  };

  const decision = makeDecision("RETRY_NOW");

  const verdict = evaluateGuardrails(
    payment,
    decision,
  );

  assert(
    !verdict.allowed,
    "Renewal without mandate information must be blocked",
  );

  assert(
    verdict.blockedBy.includes(
      "MANDATE_INFORMATION_MISSING",
    ),
    "Missing mandate information must be explicit",
  );
}

/* -------------------------------------------------------------------------- */
/* Decline-code whitelist                                                      */
/* -------------------------------------------------------------------------- */

{
  const payment: FailedPayment = {
    ...BASE_PAYMENT,
    declineCode: "CARD_EXPIRED",
  };

  const decision = makeDecision("RETRY_NOW");

  const verdict = evaluateGuardrails(
    payment,
    decision,
  );

  assert(
    !verdict.allowed,
    "An action forbidden by the decline taxonomy must be blocked",
  );

  assert(
    verdict.blockedBy.includes(
      "INTERVENTION_NOT_ALLOWED_FOR_DECLINE",
    ),
    "Decline-code violation must be explicit",
  );
}

console.log(
  "✓ guardrail invariants hold — deterministic safety boundary verified",
);