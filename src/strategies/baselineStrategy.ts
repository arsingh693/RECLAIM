import {
  AttemptOutcome,
  FailedPayment,
} from "../domain/types";

import {
  PaymentGateway,
} from "../gateway/types";

export interface BaselineRunRecord {
  readonly payment: FailedPayment;
  readonly outcomes: readonly AttemptOutcome[];
  readonly blockedByGuardrails: number;
  readonly escalatedToHuman: number;
  readonly customerContacts: number;
}

/**
 * Deliberately simple fixed retry strategy.
 *
 * This is the control group for the experiment.
 *
 * The baseline does NOT:
 * - reason about the failure context
 * - infer customer timing
 * - switch intelligently between rails
 * - adapt retry timing to the failure
 * - use an LLM
 *
 * It simply retries eligible payments using a fixed schedule.
 *
 * That simplicity is intentional. A benchmark is useful only
 * when its behavior is deterministic and understandable.
 */
export async function runBaselineForPayment(
  payment: FailedPayment,
  gateway: PaymentGateway,
): Promise<BaselineRunRecord> {
  const outcomes: AttemptOutcome[] = [];

  let currentPayment = payment;

  /**
   * Fixed retry ladder:
   *
   * Attempt 1 → immediately
   * Attempt 2 → after 24 hours
   * Attempt 3 → after 72 hours
   *
   * The simulator does not need to actually wait. The schedule
   * is represented by the deterministic gateway behavior.
   */
  const maxAdditionalAttempts = 3;

  for (
    let retry = 0;
    retry < maxAdditionalAttempts;
    retry += 1
  ) {
    if (
      currentPayment.attemptsSoFar >= 3
    ) {
      break;
    }

    /**
     * Baseline only retries failures that are conventionally
     * retryable. Permanent failures are intentionally left alone.
     */
    if (
      !isBaselineRetryable(
        currentPayment,
      )
    ) {
      break;
    }

    const attemptNumber =
      currentPayment.attemptsSoFar + 1;

    const request = {
      paymentId:
        currentPayment.id,
      amountPaise:
        currentPayment.amountPaise,
      currency:
        currentPayment.currency,
      method:
        currentPayment.method,
      attemptNumber,
      idempotencyKey:
        `${currentPayment.id}:baseline:attempt:${attemptNumber}`,
    };

    const outcome =
      await gateway.charge(
        request,
      );

    outcomes.push(outcome);

    /**
     * Once a charge succeeds, the baseline stops.
     * Continuing would create unnecessary payment attempts.
     */
    if (
      outcome.succeeded
    ) {
      break;
    }

    /**
     * If the gateway says the outcome is indeterminate,
     * the baseline cannot safely charge again without
     * reconciliation.
     *
     * This prevents the control group from accidentally
     * becoming an unsafe benchmark.
     */
    if (
      outcome.indeterminate
    ) {
      break;
    }

    /**
     * Keep the attempt count aligned with the logical
     * payment state for the next iteration.
     */
    currentPayment = {
      ...currentPayment,
      attemptsSoFar:
        currentPayment.attemptsSoFar + 1,
    };
  }

  return {
    payment,
    outcomes,
    blockedByGuardrails: 0,
    escalatedToHuman: 0,
    customerContacts: 0,
  };
}

/**
 * Fixed baseline eligibility.
 *
 * We deliberately keep this much less sophisticated than
 * RECLAIM's adaptive policy.
 */
function isBaselineRetryable(
  payment: FailedPayment,
): boolean {
  switch (
    payment.declineCode
  ) {
    case "INSUFFICIENT_FUNDS":
    case "ISSUER_UNAVAILABLE":
    case "LIMIT_EXCEEDED":
    case "DO_NOT_HONOUR":
    case "AUTHENTICATION_FAILED":
    case "MANDATE_LIMIT_EXCEEDED":
      return true;

    case "CARD_EXPIRED":
    case "CARD_BLOCKED":
    case "GATEWAY_TIMEOUT":
    case "MANDATE_PAUSED":
    case "RISK_BLOCKED":
    case "INVALID_INSTRUMENT":
      return false;

    default:
      return false;
  }
}