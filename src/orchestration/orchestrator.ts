import type {
  AttemptOutcome,
  Decision,
  FailedPayment,
  PaymentMethod,
} from "../domain/types";

import {
  decideWithAgent,
} from "../ai/decisionAgent";

import type {
  AIProvider,
} from "../ai/types";

import {
  executeDecision,
} from "./executor";

import {
  AuditTrail,
  validateAuditTrail,
} from "./audit";

import type {
  PaymentGateway,
} from "../gateway/types";

export interface OrchestrationResult {
  readonly payment: FailedPayment;
  readonly decision: Decision;
  readonly guardrail: ReturnType<
    typeof executeDecision
  > extends Promise<infer R>
    ? R extends {
        guardrail: infer G;
      }
      ? G
      : never
    : never;
  readonly outcome: AttemptOutcome | null;
  readonly executed: boolean;
  readonly aiFallbackUsed: boolean;
  readonly aiConfidence: number;
}

export interface BatchOrchestrationResult {
  readonly results: readonly OrchestrationResult[];
  readonly auditTrail: ReturnType<
    AuditTrail["snapshot"]
  >;
}

export interface OrchestrationOptions {
  readonly aiProvider: AIProvider;
}

/**
 * Orchestrate one failed payment.
 *
 * The AI is introduced only at the decision point.
 *
 *     failed payment
 *          ↓
 *     candidate policy
 *          ↓
 *       AI agent
 *          ↓
 *    validated decision
 *          ↓
 *      guardrails
 *          ↓
 *       executor
 *          ↓
 *       gateway
 *
 * The AI never receives direct gateway access.
 */
export async function orchestratePayment(
  payment: FailedPayment,
  gateway: PaymentGateway,
  aiProvider: AIProvider,
): Promise<OrchestrationResult> {
  const agentResult =
    await decideWithAgent(
      payment,
      {
        provider: aiProvider,
        fallbackIntervention:
          getSafeFallbackIntervention(
            payment,
          ),
      },
    );

  /**
   * A null intervention should never escape the agent layer.
   *
   * The fallback is still kept here as a final defensive boundary.
   */
  const intervention =
    agentResult.intervention ??
    getSafeFallbackIntervention(
      payment,
    );

  const decision: Decision = {
    paymentId: payment.id,
    intervention,
    scheduledFor:
      buildScheduledFor(
        payment,
        intervention,
      ),
    switchToMethod:
      buildAlternateRail(
        payment,
        intervention,
      ),
    splitAmountPaise:
      buildSplitAmount(
        payment,
        intervention,
      ),
    reasoning:
      agentResult.reasoning,
    rejectedAlternatives:
      agentResult.candidates
        .filter(
          (candidate) =>
            candidate.intervention !==
            intervention,
        )
        .map(
          (candidate) =>
            candidate.intervention,
        ),
    source:
      agentResult.source,
    decidedAt:
      new Date().toISOString(),
  };

  const execution =
    await executeDecision(
      payment,
      decision,
      {
        gateway,
      },
    );

  return {
    payment,
    decision,
    guardrail:
      execution.guardrail,
    outcome:
      execution.outcome,
    executed:
      execution.executed,
    aiFallbackUsed:
      agentResult.fallbackUsed,
    aiConfidence:
      agentResult.confidence,
  };
}

/**
 * Process a complete batch sequentially.
 *
 * Sequential execution remains intentional while we establish correctness.
 */
export async function orchestrateBatch(
  payments: readonly FailedPayment[],
  gateway: PaymentGateway,
  aiProvider: AIProvider,
): Promise<BatchOrchestrationResult> {
  const auditTrail =
    new AuditTrail();

  const results:
    OrchestrationResult[] = [];

  for (const payment of payments) {
    const result =
      await orchestratePayment(
        payment,
        gateway,
        aiProvider,
      );

    results.push(result);

    auditTrail.append(
      payment,
      result.decision,
      result.guardrail,
      result.outcome,
    );
  }

  const auditSnapshot =
    auditTrail.snapshot();

  validateAuditTrail(
    auditSnapshot,
  );

  return {
    results,
    auditTrail:
      auditSnapshot,
  };
}

/**
 * Determine the final fallback intervention.
 *
 * We deliberately choose a candidate from the existing deterministic
 * candidate policy instead of inventing a new action here.
 */
function getSafeFallbackIntervention(
  payment: FailedPayment,
): Decision["intervention"] {
  switch (payment.declineCode) {
    case "GATEWAY_TIMEOUT":
      return "RECONCILE_THEN_DECIDE";

    case "CARD_EXPIRED":
    case "INVALID_INSTRUMENT":
      return "REQUEST_INSTRUMENT_UPDATE";

    case "AUTHENTICATION_FAILED":
      return "REQUEST_REAUTHORIZATION";

    case "RISK_BLOCKED":
      return "STOP_PERMANENT";

    case "MANDATE_PAUSED":
      return "REQUEST_REAUTHORIZATION";

    case "MANDATE_LIMIT_EXCEEDED":
      return "REQUEST_REAUTHORIZATION";

    case "CARD_BLOCKED":
      return "REQUEST_INSTRUMENT_UPDATE";

    case "DO_NOT_HONOUR":
      return "ESCALATE_HUMAN";

    case "INSUFFICIENT_FUNDS":
      return "RETRY_SCHEDULED";

    case "ISSUER_UNAVAILABLE":
      return "RETRY_SCHEDULED";

    case "LIMIT_EXCEEDED":
      return "RETRY_SPLIT_AMOUNT";

    default:
      return "STOP_PERMANENT";
  }
}

/**
 * Resolve timing for a scheduled intervention.
 *
 * This is deterministic and intentionally separate from the AI.
 */
function buildScheduledFor(
  payment: FailedPayment,
  intervention: Decision["intervention"],
): string | null {
  if (
    intervention !==
    "RETRY_SCHEDULED"
  ) {
    return null;
  }

  const failedAt =
    Date.parse(
      payment.failedAt,
    );

  if (
    !Number.isFinite(
      failedAt,
    )
  ) {
    return null;
  }

  let delayHours = 24;

  if (
    payment.declineCode ===
    "ISSUER_UNAVAILABLE"
  ) {
    delayHours = 1;
  }

  if (
    payment.declineCode ===
      "INSUFFICIENT_FUNDS" &&
    payment.customer
      .historicalPaydayHint !== null
  ) {
    /**
     * The payday hint is useful context but is not itself
     * a guaranteed date. The scheduler will later be able
     * to resolve an exact execution time.
     */
    delayHours = 48;
  }

  return new Date(
    failedAt +
      delayHours *
        60 *
        60 *
        1000,
  ).toISOString();
}

/**
 * Select an alternate payment rail only when the AI selected
 * the alternate-rail intervention.
 */
function buildAlternateRail(
  payment: FailedPayment,
  intervention: Decision["intervention"],
): PaymentMethod | null {
  if (
    intervention !==
    "RETRY_ALTERNATE_RAIL"
  ) {
    return null;
  }

  return (
    payment.customer.availableMethods.find(
      (method) =>
        method !==
        payment.method,
    ) ?? null
  );
}

/**
 * Determine the amount for a split-charge action.
 *
 * Guardrails remain responsible for deciding whether the amount
 * is actually permitted.
 */
function buildSplitAmount(
  payment: FailedPayment,
  intervention: Decision["intervention"],
): number | null {
  if (
    intervention !==
    "RETRY_SPLIT_AMOUNT"
  ) {
    return null;
  }

  return Math.ceil(
    payment.amountPaise / 2,
  );
}