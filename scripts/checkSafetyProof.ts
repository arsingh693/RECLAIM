import type {
  AttemptOutcome,
  FailedPayment,
  Decision,
  Intervention,
  CustomerContext,
} from "../src/domain/types";

import {
  getCandidateActions,
} from "../src/policy/candidateActions";

import {
  getDeclineProfile,
} from "../src/domain/declineCodes";

import {
  validateAIResponse,
} from "../src/ai/provider";

import type {
  AIDecisionRequest,
  AIDecisionResponse,
} from "../src/ai/types";

import {
  evaluateGuardrails,
} from "../src/policy/guardrails";

import {
  executeDecision,
} from "../src/orchestration/executor";

import type {
  PaymentGateway,
  ChargeRequest,
  ReconcileRequest,
  ReconciliationResult,
  RecoveryLinkRequest,
  RecoveryLinkResult,
} from "../src/gateway/types";

function assert(
  condition: boolean,
  message: string,
): void {
  if (!condition) {
    throw new Error(message);
  }
}

function makeCustomer(
  overrides: Partial<CustomerContext> = {},
): CustomerContext {
  return {
    customerId: "proof-customer",
    successfulChargesLifetime: 10,
    consecutiveFailures: 0,
    availableMethods: [
      "card",
      "upi",
    ],
    historicalPaydayHint: 1,
    contactOptOut: false,
    hasOpenDispute: false,
    timezone: "Asia/Kolkata",
    ...overrides,
  };
}

function makePayment(
  overrides: Partial<FailedPayment> = {},
): FailedPayment {
  return {
    id: "pay_proof",
    merchantId: "merchant_proof",
    chargeKind: "one_time",
    amountPaise: 10000,
    currency: "INR",
    method: "card",
    declineCode:
      "INSUFFICIENT_FUNDS",
    gatewayRawReason:
      "insufficient funds",
    failedAt:
      "2026-08-31T04:00:00.000Z",
    attemptsSoFar: 0,
    customer:
      makeCustomer(),
    mandateCeilingPaise:
      null,
    ...overrides,
  };
}

function makeDecision(
  payment: FailedPayment,
  intervention: Intervention,
  overrides: Partial<Decision> = {},
): Decision {
  return {
    paymentId: payment.id,
    intervention,
    scheduledFor:
      intervention ===
      "RETRY_SCHEDULED"
        ? "2026-09-01T04:00:00.000Z"
        : null,
    switchToMethod:
      intervention ===
      "RETRY_ALTERNATE_RAIL"
        ? "upi"
        : null,
    splitAmountPaise:
      intervention ===
      "RETRY_SPLIT_AMOUNT"
        ? 5000
        : null,
    reasoning:
      "Safety proof decision",
    rejectedAlternatives: [],
    source: "fallback",
    decidedAt:
      "2026-08-31T04:00:00.000Z",
    ...overrides,
  };
}

class CountingGateway
  implements PaymentGateway
{
  readonly name = "proof-gateway";

  chargeCalls = 0;
  reconcileCalls = 0;
  recoveryLinkCalls = 0;

  async charge(
    _request: ChargeRequest,
  ): Promise<AttemptOutcome> {
    this.chargeCalls += 1;

    return {
      paymentId:
        _request.paymentId,
      succeeded: true,
      recoveredPaise:
        _request.amountPaise,
      declineCode: null,
      gatewayReference:
        "proof-charge",
      attemptedAt:
        "2026-08-31T04:00:01.000Z",
      indeterminate: false,
    };
  }

  async reconcile(
    request: ReconcileRequest,
  ): Promise<ReconciliationResult> {
    this.reconcileCalls += 1;

    return {
      paymentId:
        request.paymentId,
      status: "unknown",
      outcome: null,
      gatewayReference: null,
      checkedAt:
        "2026-08-31T04:00:02.000Z",
    };
  }

  async createRecoveryLink(
    request: RecoveryLinkRequest,
  ): Promise<RecoveryLinkResult> {
    this.recoveryLinkCalls += 1;

    return {
      paymentId:
        request.payment.id,
      supported: true,
      url: "https://proof.invalid/recovery",
      gatewayReference:
        "proof-link",
      reason: null,
    };
  }
}

async function main(): Promise<void> {
  /*
   * ---------------------------------------------------------------
   * 1. Candidate-set containment proof
   * ---------------------------------------------------------------
   *
   * Every candidate action must belong to the hard taxonomy whitelist.
   */
  const declineCodes = [
    "INSUFFICIENT_FUNDS",
    "CARD_EXPIRED",
    "CARD_BLOCKED",
    "ISSUER_UNAVAILABLE",
    "GATEWAY_TIMEOUT",
    "LIMIT_EXCEEDED",
    "DO_NOT_HONOUR",
    "AUTHENTICATION_FAILED",
    "MANDATE_PAUSED",
    "MANDATE_LIMIT_EXCEEDED",
    "RISK_BLOCKED",
    "INVALID_INSTRUMENT",
  ] as const;

  for (
    const code of declineCodes
  ) {
    const payment =
      makePayment({
        id:
          `candidate-${code}`,
        declineCode:
          code,
      });

    const candidates =
      getCandidateActions(
        payment,
      );

    const profile =
      getDeclineProfile(code);

    for (
      const candidate of candidates
    ) {
      assert(
        profile.allowedInterventions.includes(
          candidate,
        ),
        `Candidate ${candidate} escaped taxonomy for ${code}`,
      );
    }
  }

  console.log(
    "✓ candidate actions are contained by taxonomy",
  );

  /*
   * ---------------------------------------------------------------
   * 2. AI cannot widen the action space
   * ---------------------------------------------------------------
   */
  const payment =
    makePayment();

  const candidates =
    getCandidateActions(
      payment,
    );

  const request: AIDecisionRequest =
    {
      payment,
      candidates:
        candidates.map(
          (intervention) => ({
            intervention,
            rationale:
              "proof candidate",
          }),
        ),
      policyContext:
        "proof context",
    };

  const forbiddenResponse:
    AIDecisionResponse = {
      intervention:
        "RETRY_NOW",
      reasoning:
        "malicious test response",
      confidence: 1,
    };

  /**
   * RETRY_NOW is deliberately not permitted for
   * INSUFFICIENT_FUNDS.
   */
  assert(
    !candidates.includes(
      "RETRY_NOW",
    ),
    "Proof setup is invalid: RETRY_NOW unexpectedly became a candidate",
  );

  let aiRejected = false;

  try {
    validateAIResponse(
      request,
      forbiddenResponse,
    );
  } catch {
    aiRejected = true;
  }

  assert(
    aiRejected,
    "AI validation failed to reject an intervention outside the candidate set",
  );

  console.log(
    "✓ AI cannot widen the permitted action space",
  );

  /*
   * ---------------------------------------------------------------
   * 3. Invalid confidence is rejected
   * ---------------------------------------------------------------
   */
  const invalidConfidence:
    AIDecisionResponse = {
      intervention:
        candidates[0]!,
      reasoning:
        "invalid confidence test",
      confidence: 2,
    };

  let confidenceRejected =
    false;

  try {
    validateAIResponse(
      request,
      invalidConfidence,
    );
  } catch {
    confidenceRejected = true;
  }

  assert(
    confidenceRejected,
    "AI validation accepted confidence outside [0,1]",
  );

  console.log(
    "✓ invalid AI confidence is rejected",
  );

  /*
   * ---------------------------------------------------------------
   * 4. Guardrail block prevents gateway execution
   * ---------------------------------------------------------------
   */
  const riskPayment =
    makePayment({
      id: "risk-proof",
      declineCode:
        "RISK_BLOCKED",
    });

  const unsafeDecision =
    makeDecision(
      riskPayment,
      "STOP_PERMANENT",
    );

  /**
   * STOP_PERMANENT is intentionally allowed for a risk block.
   * Prove that it does not reach the gateway.
   */
  const stopVerdict =
    evaluateGuardrails(
      riskPayment,
      unsafeDecision,
    );

  assert(
    stopVerdict.allowed,
    "STOP_PERMANENT should be allowed for RISK_BLOCKED",
  );

  const gateway =
    new CountingGateway();

  const stopExecution =
    await executeDecision(
      riskPayment,
      unsafeDecision,
      {
        gateway,
      },
    );

  assert(
    !stopExecution.executed,
    "STOP_PERMANENT must not execute a gateway charge",
  );

  assert(
    gateway.chargeCalls === 0,
    "Non-charge decision reached the gateway",
  );

  console.log(
    "✓ non-charge decisions cannot reach gateway",
  );

  /*
   * ---------------------------------------------------------------
   * 5. Open dispute blocks money movement
   * ---------------------------------------------------------------
   */
  const disputePayment =
    makePayment({
      id: "dispute-proof",
      customer:
        makeCustomer({
          hasOpenDispute: true,
        }),
    });

  const retryDecision =
    makeDecision(
      disputePayment,
      "RETRY_SCHEDULED",
    );

  const disputeVerdict =
    evaluateGuardrails(
      disputePayment,
      retryDecision,
    );

  assert(
    !disputeVerdict.allowed,
    "Open dispute must block money-moving recovery",
  );

  assert(
    disputeVerdict.blockedBy.includes(
      "OPEN_DISPUTE",
    ),
    "Open dispute block reason was not recorded",
  );

  console.log(
    "✓ open disputes block money movement",
  );

  /*
   * ---------------------------------------------------------------
   * 6. Risk block cannot charge on any rail
   * ---------------------------------------------------------------
   */
  const riskRetry =
    makeDecision(
      riskPayment,
      "RETRY_ALTERNATE_RAIL",
    );

  const riskVerdict =
    evaluateGuardrails(
      riskPayment,
      riskRetry,
    );

  assert(
    !riskVerdict.allowed,
    "RISK_BLOCKED must not permit alternate-rail charging",
  );

  console.log(
    "✓ risk blocks cannot be bypassed via another rail",
  );

  /*
   * ---------------------------------------------------------------
   * 7. Attempt ceiling proof
   * ---------------------------------------------------------------
   */
  const exhaustedPayment =
    makePayment({
      id: "ceiling-proof",
      attemptsSoFar: 3,
    });

  const exhaustedDecision =
    makeDecision(
      exhaustedPayment,
      "RETRY_SCHEDULED",
    );

  const ceilingVerdict =
    evaluateGuardrails(
      exhaustedPayment,
      exhaustedDecision,
    );

  assert(
    !ceilingVerdict.allowed,
    "Attempt ceiling failed to block an additional charge",
  );

  assert(
    ceilingVerdict.blockedBy.includes(
      "ATTEMPT_CEILING",
    ),
    "Attempt ceiling block reason was not recorded",
  );

  console.log(
    "✓ attempt ceilings cannot be exceeded",
  );

  /*
   * ---------------------------------------------------------------
   * 8. Gateway timeout proof
   * ---------------------------------------------------------------
   */
  const timeoutPayment =
    makePayment({
      id: "timeout-proof",
      declineCode:
        "GATEWAY_TIMEOUT",
    });

  const timeoutRetry =
    makeDecision(
      timeoutPayment,
      "RETRY_SCHEDULED",
    );

  const timeoutVerdict =
    evaluateGuardrails(
      timeoutPayment,
      timeoutRetry,
    );

  assert(
    !timeoutVerdict.allowed,
    "Gateway timeout allowed a direct retry",
  );

  assert(
    timeoutVerdict.blockedBy.includes(
      "UNRECONCILED_GATEWAY_TIMEOUT",
    ),
    "Gateway timeout block reason was not recorded",
  );

  const reconcileDecision =
    makeDecision(
      timeoutPayment,
      "RECONCILE_THEN_DECIDE",
    );

  const reconcileVerdict =
    evaluateGuardrails(
      timeoutPayment,
      reconcileDecision,
    );

  assert(
    reconcileVerdict.allowed,
    "Gateway timeout reconciliation should be permitted",
  );

  console.log(
    "✓ gateway timeouts require reconciliation before retry",
  );

  /*
   * ---------------------------------------------------------------
   * 9. Mandate ceiling proof
   * ---------------------------------------------------------------
   */
  const mandatePayment =
    makePayment({
      id: "mandate-proof",
      chargeKind:
        "subscription_renewal",
      declineCode:
        "MANDATE_LIMIT_EXCEEDED",
      mandateCeilingPaise:
        5000,
    });

  const oversizedDecision =
    makeDecision(
      mandatePayment,
      "RETRY_NOW",
    );

  const oversizedVerdict =
    evaluateGuardrails(
      mandatePayment,
      oversizedDecision,
    );

  assert(
    !oversizedVerdict.allowed,
    "Mandate ceiling should block an oversized charge",
  );

  console.log(
    "✓ mandate ceilings protect authorization boundaries",
  );

  /*
   * ---------------------------------------------------------------
   * 10. Final aggregate proof
   * ---------------------------------------------------------------
   */
  assert(
    gateway.chargeCalls === 0,
    "Safety proof gateway unexpectedly executed a charge",
  );

  console.log("");
  console.log(
    "========================================",
  );
  console.log(
    "       RECLAIM ADVERSARIAL PROOF",
  );
  console.log(
    "========================================",
  );
  console.log("");
  console.log(
    "✓ taxonomy containment",
  );
  console.log(
    "✓ AI action-space containment",
  );
  console.log(
    "✓ AI confidence validation",
  );
  console.log(
    "✓ gateway execution isolation",
  );
  console.log(
    "✓ open-dispute protection",
  );
  console.log(
    "✓ risk-block protection",
  );
  console.log(
    "✓ attempt-ceiling protection",
  );
  console.log(
    "✓ timeout reconciliation protection",
  );
  console.log(
    "✓ mandate-ceiling protection",
  );
  console.log("");
  console.log(
    "✓ all adversarial safety proofs passed",
  );
}

main().catch(
  (error: unknown) => {
    console.error(
      "✗ adversarial safety proof failed",
    );
    console.error(error);
    process.exitCode = 1;
  },
);