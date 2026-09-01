/**
 * Deterministic recovery decision policy.
 *
 * This is deliberately NOT the LLM.
 *
 * The policy establishes the "safe answer space":
 *   - what interventions make sense for a failure
 *   - what timing is appropriate
 *   - what context should influence the decision
 *
 * Later, the LLM will rank/select among these permitted candidates.
 *
 * IMPORTANT:
 * The policy never grants permission to charge.
 * Final permission always comes from guardrails.ts.
 */

import type {
  CustomerContext,
  FailedPayment,
  Intervention,
} from "../domain/types";

import {
  getDeclineProfile,
} from "../domain/declineCodes";

import {
  getCandidateActions,
} from "./candidateActions";

export interface PolicyCandidate {
  readonly intervention: Intervention;

  /**
   * Numeric score used by the deterministic fallback.
   *
   * This is intentionally simple and explainable.
   * The eventual LLM can make a richer contextual choice.
   */
  readonly score: number;

  /**
   * Human-readable explanation of why this option
   * is appropriate for the current payment.
   */
  readonly rationale: string;

  /**
   * Whether the action consumes a charge attempt.
   */
  readonly consumesChargeAttempt: boolean;
}

export interface PolicyDecision {
  readonly paymentId: string;

  readonly selected:
    | Intervention
    | null;

  readonly scheduledFor:
    | string
    | null;

  readonly switchToMethod:
    | FailedPayment["method"]
    | null;

  readonly splitAmountPaise:
    | number
    | null;

  readonly reasoning: string;

  readonly candidates:
    readonly PolicyCandidate[];

  readonly rejectedAlternatives:
    readonly Intervention[];
}

/**
 * Add context-specific scoring to an otherwise valid candidate.
 *
 * This is the deterministic fallback/ranking logic.
 *
 * It is deliberately conservative:
 * we never manufacture an intervention that isn't already
 * present in candidateActions.ts.
 */
function scoreCandidate(
  payment: FailedPayment,
  customer: CustomerContext,
  intervention: Intervention,
): PolicyCandidate {
  let score = 0;
  let rationale = "";

  switch (intervention) {
    case "RETRY_NOW": {
      score += 50;

      rationale =
        "The failure may be transient, so an immediate retry is a viable recovery path.";

      if (
        payment.declineCode ===
        "ISSUER_UNAVAILABLE"
      ) {
        score += 30;

        rationale =
          "The issuer appears temporarily unavailable; an immediate retry has a reasonable chance of succeeding.";
      }

      if (
        payment.declineCode ===
        "DO_NOT_HONOUR"
      ) {
        score -= 25;

        rationale =
          "The issuer did not honour the transaction, so an immediate repeat attempt is less attractive.";
      }

      break;
    }

    case "RETRY_SCHEDULED": {
      score += 60;

      rationale =
        "A delayed retry avoids immediately repeating a failure that may be temporary or timing-dependent.";

      if (
        payment.declineCode ===
        "INSUFFICIENT_FUNDS"
      ) {
        score += 35;

        rationale =
          "Insufficient funds are often timing-sensitive, making a scheduled retry preferable to repeated immediate attempts.";

        if (
          customer.historicalPaydayHint !==
          null
        ) {
          score += 25;

          rationale =
            "The customer has a historical payment-day signal, making a delayed retry around that period more appropriate.";
        }
      }

      if (
        payment.declineCode ===
        "ISSUER_UNAVAILABLE"
      ) {
        score += 20;

        rationale =
          "A short delay gives a temporarily unavailable issuer time to recover.";
      }

      break;
    }

    case "RETRY_ALTERNATE_RAIL": {
      score += 70;

      rationale =
        "A different available payment rail can avoid the condition that caused the primary instrument to fail.";

      if (
        customer.availableMethods.length >
        1
      ) {
        score += 20;
      }

      if (
        payment.declineCode ===
          "CARD_EXPIRED" ||
        payment.declineCode ===
          "CARD_BLOCKED" ||
        payment.declineCode ===
          "INVALID_INSTRUMENT"
      ) {
        score += 35;

        rationale =
          "The primary instrument is unsuitable for another attempt, so an available alternate rail is materially preferable.";
      }

      if (
        payment.declineCode ===
        "INSUFFICIENT_FUNDS"
      ) {
        score += 20;

        rationale =
          "An alternate rail may succeed without waiting for funds to become available on the primary instrument.";
      }

      break;
    }

    case "RETRY_SPLIT_AMOUNT": {
      score += 55;

      rationale =
        "A smaller charge can be useful when the full amount exceeds an instrument or transaction limit.";

      if (
        payment.declineCode ===
        "LIMIT_EXCEEDED"
      ) {
        score += 40;

        rationale =
          "The payment exceeded a limit, so splitting the amount can address the constraint without changing the customer relationship.";
      }

      if (
        payment.declineCode ===
        "MANDATE_LIMIT_EXCEEDED"
      ) {
        score -= 100;

        rationale =
          "A mandate limit cannot be bypassed by arbitrarily splitting the amount.";
      }

      break;
    }

    case "RECONCILE_THEN_DECIDE": {
      score += 100;

      rationale =
        "The gateway outcome is indeterminate, so reconciliation must establish whether money actually moved before another charge is considered.";

      break;
    }

    case "REQUEST_INSTRUMENT_UPDATE": {
      score += 95;

      rationale =
        "The stored payment instrument appears invalid or unusable, so the customer should update it before another attempt.";

      if (
        payment.declineCode ===
        "CARD_EXPIRED"
      ) {
        score += 40;

        rationale =
          "The card has expired; requesting updated payment credentials is more appropriate than retrying the expired instrument.";
      }

      if (
        payment.declineCode ===
        "INVALID_INSTRUMENT"
      ) {
        score += 40;

        rationale =
          "The payment instrument is invalid, so updated payment details are required before recovery can continue.";
      }

      if (
        payment.declineCode ===
        "CARD_BLOCKED"
      ) {
        score += 20;

        rationale =
          "The primary card is blocked, making an instrument update preferable to repeated attempts.";
      }

      break;
    }

    case "REQUEST_REAUTHORIZATION": {
      score += 90;

      rationale =
        "The payment requires renewed customer authentication before another charge should be attempted.";

      if (
        payment.declineCode ===
        "AUTHENTICATION_FAILED"
      ) {
        score += 35;

        rationale =
          "Authentication failed, so renewed customer authorization is required before retrying.";
      }

      break;
    }

    case "NUDGE_THEN_RETRY": {
      score += 75;

      rationale =
        "A customer-facing reminder can resolve a recoverable payment issue before another charge attempt.";

      if (
        payment.declineCode ===
        "INSUFFICIENT_FUNDS"
      ) {
        score += 25;

        rationale =
          "The customer may need to replenish funds before the next attempt.";
      }

      if (
        payment.declineCode ===
        "AUTHENTICATION_FAILED"
      ) {
        score += 10;

        rationale =
          "A reminder can direct the customer to complete the required authentication.";
      }

      break;
    }

    case "ESCALATE_HUMAN": {
      score += 80;

      rationale =
        "The situation should be reviewed by a human rather than repeatedly attempting automated recovery.";

      if (
        payment.declineCode ===
        "DO_NOT_HONOUR"
      ) {
        score += 25;
      }

      break;
    }

    case "STOP_PERMANENT": {
      score += 1000;

      rationale =
        "The payment should not be pursued automatically because the failure represents a hard stop.";

      if (
        payment.declineCode ===
        "RISK_BLOCKED"
      ) {
        score += 500;

        rationale =
          "The payment was blocked by risk controls, so automated recovery must stop.";
      }

      if (
        payment.declineCode ===
        "CARD_BLOCKED"
      ) {
        score += 100;

        rationale =
          "The instrument is blocked and should not be repeatedly charged.";
      }

      break;
    }
  }

  const consumesChargeAttempt =
    intervention ===
      "RETRY_NOW" ||
    intervention ===
      "RETRY_SCHEDULED" ||
    intervention ===
      "RETRY_ALTERNATE_RAIL" ||
    intervention ===
      "RETRY_SPLIT_AMOUNT";

  return {
    intervention,
    score,
    rationale,
    consumesChargeAttempt,
  };
}

/**
 * Pick the best candidate using the deterministic fallback policy.
 *
 * This function is useful even after the LLM is introduced:
 * if Gemini is unavailable, malformed, unsafe, or overridden
 * by guardrails, the system still has a defensible answer.
 */
export function chooseDeterministicPolicy(
  payment: FailedPayment,
): PolicyDecision {
  const customer =
    payment.customer;

  const candidateInterventions =
    getCandidateActions(
      payment,
    );

  const candidates =
    candidateInterventions
      .map(
        (intervention) =>
          scoreCandidate(
            payment,
            customer,
            intervention,
          ),
      )
      .sort(
        (a, b) =>
          b.score - a.score,
      );

  const selected =
    candidates[0] ?? null;

  const rejectedAlternatives =
    candidates
      .slice(1)
      .map(
        (candidate) =>
          candidate.intervention,
      );

  /**
   * Special case:
   *
   * A gateway timeout does not describe a failed payment.
   * It describes an unknown payment state.
   *
   * Therefore reconciliation outranks every normal recovery action.
   */
  if (
    payment.declineCode ===
    "GATEWAY_TIMEOUT"
  ) {
    return {
      paymentId: payment.id,
      selected:
        "RECONCILE_THEN_DECIDE",
      scheduledFor: null,
      switchToMethod: null,
      splitAmountPaise: null,
      reasoning:
        "The gateway returned an indeterminate result. Reconciliation must establish the true payment state before any further charge attempt.",
      candidates,
      rejectedAlternatives:
        candidates
          .filter(
            (candidate) =>
              candidate.intervention !==
              "RECONCILE_THEN_DECIDE",
          )
          .map(
            (candidate) =>
              candidate.intervention,
          ),
    };
  }

  /**
   * Determine a useful schedule for delayed recovery.
   *
   * The actual scheduler/orchestrator will later turn this
   * into an executable timestamp.
   *
   * Here we only express the policy preference.
   */
  let scheduledFor:
    | string
    | null = null;

  if (
    selected?.intervention ===
    "RETRY_SCHEDULED"
  ) {
    const failedAt =
      Date.parse(
        payment.failedAt,
      );

    if (
      Number.isFinite(
        failedAt,
      )
    ) {
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
        customer.historicalPaydayHint !==
          null
      ) {
        /**
         * We deliberately do not invent a precise payday
         * timestamp here. The historical hint is a day-of-month
         * signal, not a guarantee.
         *
         * The scheduler can resolve this safely later.
         */
        delayHours = 48;
      }

      scheduledFor =
        new Date(
          failedAt +
            delayHours *
              60 *
              60 *
              1000,
        ).toISOString();
    }
  }

  return {
    paymentId: payment.id,
    selected:
      selected?.intervention ??
      null,
    scheduledFor,
    switchToMethod:
      selected?.intervention ===
      "RETRY_ALTERNATE_RAIL"
        ? customer.availableMethods.find(
            (method) =>
              method !==
              payment.method,
          ) ?? null
        : null,
    splitAmountPaise:
      selected?.intervention ===
      "RETRY_SPLIT_AMOUNT"
        ? Math.ceil(
            payment.amountPaise /
              2,
          )
        : null,
    reasoning:
      selected?.rationale ??
      "No permissible recovery intervention was identified.",
    candidates,
    rejectedAlternatives,
  };
}

/**
 * Return the policy constraints that should be supplied
 * to the eventual LLM prompt.
 *
 * This keeps the model's available action space aligned
 * with the deterministic policy.
 */
export function buildPolicyContext(
  payment: FailedPayment,
): string {
  const profile =
    getDeclineProfile(
      payment.declineCode,
    );

  const candidates =
    getCandidateActions(
      payment,
    );

  return [
    `Payment: ${payment.id}`,
    `Failure: ${payment.declineCode}`,
    `Amount: ${payment.amountPaise} paise`,
    `Current attempts: ${payment.attemptsSoFar}`,
    `Maximum charge attempts: ${profile.maxChargeAttempts}`,
    `Primary method: ${payment.method}`,
    `Available methods: ${payment.customer.availableMethods.join(", ")}`,
    `Successful charges lifetime: ${payment.customer.successfulChargesLifetime}`,
    `Consecutive failures: ${payment.customer.consecutiveFailures}`,
    `Historical payday hint: ${
      payment.customer.historicalPaydayHint ??
      "none"
    }`,
    `Contact opt-out: ${payment.customer.contactOptOut}`,
    `Open dispute: ${payment.customer.hasOpenDispute}`,
    `Permitted interventions: ${candidates.join(", ")}`,
    "",
    "The model may choose only from the permitted interventions.",
    "The model may not increase attempt limits or create new actions.",
    "Final execution permission is determined by deterministic guardrails.",
  ].join("\n");
}