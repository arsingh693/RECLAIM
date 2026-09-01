/**
 * Candidate intervention policy.
 *
 * This file defines the CLOSED action space available to RECLAIM.
 *
 * IMPORTANT:
 *
 * The decline taxonomy is the hard source of truth:
 *
 *     declineCodes.allowedInterventions
 *                  ↓
 *          candidateActions
 *                  ↓
 *             AI selection
 *                  ↓
 *              guardrails
 *
 * candidateActions.ts must NEVER manufacture an intervention that the
 * taxonomy does not permit.
 *
 * Guardrails remain the final execution authority even when an action
 * appears in the candidate set.
 */

import type {
  FailedPayment,
  Intervention,
} from "../domain/types";

import {
  getDeclineProfile,
} from "../domain/declineCodes";

/**
 * Return the interventions that are both:
 *
 * 1. semantically relevant to the failure, and
 * 2. explicitly permitted by the hard taxonomy whitelist.
 */
export function getCandidateActions(
  payment: FailedPayment,
): readonly Intervention[] {
  const profile =
    getDeclineProfile(
      payment.declineCode,
    );

  const candidates =
    new Set<Intervention>();

  /**
   * Add an action only when the taxonomy explicitly permits it.
   *
   * This is the key consistency boundary between the semantic candidate
   * policy and the hard decline taxonomy.
   */
  const addIfAllowed = (
    intervention: Intervention,
  ): void => {
    if (
      profile.allowedInterventions.includes(
        intervention,
      )
    ) {
      candidates.add(
        intervention,
      );
    }
  };

  /**
   * A timeout is fundamentally different from a normal decline.
   *
   * We don't know whether money moved, so reconciliation is the only
   * automated next step.
   */
  if (
    payment.declineCode ===
    "GATEWAY_TIMEOUT"
  ) {
    addIfAllowed(
      "RECONCILE_THEN_DECIDE",
    );

    addIfAllowed(
      "ESCALATE_HUMAN",
    );

    return Array.from(
      candidates,
    );
  }

  /**
   * Risk blocks and open disputes are hard-stop situations.
   *
   * We still allow only actions explicitly authorised by the taxonomy.
   */
  if (
    payment.declineCode ===
      "RISK_BLOCKED" ||
    payment.customer
      .hasOpenDispute
  ) {
    addIfAllowed(
      "STOP_PERMANENT",
    );

    addIfAllowed(
      "ESCALATE_HUMAN",
    );

    return Array.from(
      candidates,
    );
  }

  /**
   * Customer opt-out affects communication, not every possible
   * recovery action.
   */
  const contactAllowed =
    !payment.customer
      .contactOptOut;

  switch (
    payment.declineCode
  ) {
    case "INSUFFICIENT_FUNDS": {
      addIfAllowed(
        "RETRY_SCHEDULED",
      );

      if (
        hasAlternateRail(
          payment,
        )
      ) {
        addIfAllowed(
          "RETRY_ALTERNATE_RAIL",
        );
      }

      /**
       * RETRY_NOW is deliberately not added here.
       *
       * The taxonomy explicitly excludes it for insufficient funds.
       */
      if (contactAllowed) {
        addIfAllowed(
          "NUDGE_THEN_RETRY",
        );
      }

      addIfAllowed(
        "ESCALATE_HUMAN",
      );

      addIfAllowed(
        "STOP_PERMANENT",
      );

      /**
       * Splitting the amount is a candidate only if the taxonomy
       * permits it and the amount is actually splittable.
       */
      if (
        payment.amountPaise > 1
      ) {
        addIfAllowed(
          "RETRY_SPLIT_AMOUNT",
        );
      }

      break;
    }

    case "CARD_EXPIRED": {
      addIfAllowed(
        "REQUEST_INSTRUMENT_UPDATE",
      );

      if (
        hasAlternateRail(
          payment,
        )
      ) {
        addIfAllowed(
          "RETRY_ALTERNATE_RAIL",
        );
      }

      addIfAllowed(
        "STOP_PERMANENT",
      );

      break;
    }

    case "CARD_BLOCKED": {
      addIfAllowed(
        "REQUEST_INSTRUMENT_UPDATE",
      );

      if (
        hasAlternateRail(
          payment,
        )
      ) {
        addIfAllowed(
          "RETRY_ALTERNATE_RAIL",
        );
      }

      addIfAllowed(
        "ESCALATE_HUMAN",
      );

      addIfAllowed(
        "STOP_PERMANENT",
      );

      break;
    }

    case "ISSUER_UNAVAILABLE": {
      addIfAllowed(
        "RETRY_SCHEDULED",
      );

      addIfAllowed(
        "RETRY_NOW",
      );

      if (
        hasAlternateRail(
          payment,
        )
      ) {
        addIfAllowed(
          "RETRY_ALTERNATE_RAIL",
        );
      }

      addIfAllowed(
        "ESCALATE_HUMAN",
      );

      addIfAllowed(
        "STOP_PERMANENT",
      );

      break;
    }

    case "LIMIT_EXCEEDED": {
      if (
        payment.amountPaise > 1
      ) {
        addIfAllowed(
          "RETRY_SPLIT_AMOUNT",
        );
      }

      if (
        hasAlternateRail(
          payment,
        )
      ) {
        addIfAllowed(
          "RETRY_ALTERNATE_RAIL",
        );
      }

      addIfAllowed(
        "RETRY_SCHEDULED",
      );

      if (contactAllowed) {
        addIfAllowed(
          "NUDGE_THEN_RETRY",
        );
      }

      addIfAllowed(
        "ESCALATE_HUMAN",
      );

      addIfAllowed(
        "STOP_PERMANENT",
      );

      break;
    }

    case "DO_NOT_HONOUR": {
      addIfAllowed(
        "ESCALATE_HUMAN",
      );

      addIfAllowed(
        "RETRY_SCHEDULED",
      );

      if (
        hasAlternateRail(
          payment,
        )
      ) {
        addIfAllowed(
          "RETRY_ALTERNATE_RAIL",
        );
      }

      addIfAllowed(
        "STOP_PERMANENT",
      );

      break;
    }

    case "AUTHENTICATION_FAILED": {
      addIfAllowed(
        "REQUEST_REAUTHORIZATION",
      );

      if (
        hasAlternateRail(
          payment,
        )
      ) {
        addIfAllowed(
          "RETRY_ALTERNATE_RAIL",
        );
      }

      addIfAllowed(
        "REQUEST_INSTRUMENT_UPDATE",
      );

      addIfAllowed(
        "STOP_PERMANENT",
      );

      break;
    }

    case "MANDATE_PAUSED": {
      addIfAllowed(
        "REQUEST_REAUTHORIZATION",
      );

      addIfAllowed(
        "ESCALATE_HUMAN",
      );

      addIfAllowed(
        "STOP_PERMANENT",
      );

      break;
    }

    case "MANDATE_LIMIT_EXCEEDED": {
      /**
       * Splitting is permitted by the taxonomy because the important
       * boundary is the mandate ceiling. Guardrails will enforce the
       * exact amount.
       */
      if (
        payment.amountPaise > 1
      ) {
        addIfAllowed(
          "RETRY_SPLIT_AMOUNT",
        );
      }

      addIfAllowed(
        "REQUEST_REAUTHORIZATION",
      );

      addIfAllowed(
        "ESCALATE_HUMAN",
      );

      addIfAllowed(
        "STOP_PERMANENT",
      );

      break;
    }
    
    case "INVALID_INSTRUMENT": {
      addIfAllowed(
        "REQUEST_INSTRUMENT_UPDATE",
      );

      if (
        hasAlternateRail(
          payment,
        )
      ) {
        addIfAllowed(
          "RETRY_ALTERNATE_RAIL",
        );
      }

      addIfAllowed(
        "STOP_PERMANENT",
      );

      break;
    }
  }

  /**
   * Once the automated charge budget is exhausted, remove all
   * charge-producing actions.
   */
  if (
    payment.attemptsSoFar >=
    profile.maxChargeAttempts
  ) {
    candidates.delete(
      "RETRY_NOW",
    );

    candidates.delete(
      "RETRY_SCHEDULED",
    );

    candidates.delete(
      "RETRY_ALTERNATE_RAIL",
    );

    candidates.delete(
      "RETRY_SPLIT_AMOUNT",
    );

    candidates.delete(
      "NUDGE_THEN_RETRY",
    );

    /**
     * Prefer explicit human review when the automated charge budget
     * is exhausted, but only if the taxonomy permits it.
     */
    addIfAllowed(
      "ESCALATE_HUMAN",
    );
  }

  /**
   * Defensive fallback.
   *
   * An empty candidate set is possible if a future taxonomy change
   * removes every automated action. In that situation, choose human
   * escalation only if the taxonomy permits it.
   */
  if (
    candidates.size === 0
  ) {
    addIfAllowed(
      "ESCALATE_HUMAN",
    );
  }

  return Array.from(
    candidates,
  );
}

function hasAlternateRail(
  payment: FailedPayment,
): boolean {
  return payment.customer
    .availableMethods.some(
      (method) =>
        method !==
        payment.method,
    );
}