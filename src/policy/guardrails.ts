import type {
  DeclineCode,
  FailedPayment,
  Intervention,
  Decision,
  GuardrailVerdict,
} from "../domain/types";
import { getDeclineProfile } from "../domain/declineCodes";

/**
 * RECLAIM Guardrail Layer
 *
 * The policy may recommend an action.
 * The guardrail layer decides whether that action is PERMITTED.
 *
 * Important architectural rule:
 *
 *     AI / policy = chooses what looks best
 *     Guardrails  = decides what is legally/safely permitted
 *
 * The guardrail layer is deterministic and must never depend on an LLM.
 */

const CHARGE_ATTEMPT_INTERVENTIONS: ReadonlySet<Intervention> =
  new Set<Intervention>([
    "RETRY_NOW",
    "RETRY_SCHEDULED",
    "RETRY_ALTERNATE_RAIL",
    "RETRY_SPLIT_AMOUNT",
    "NUDGE_THEN_RETRY",
  ]);

const CUSTOMER_CONTACT_INTERVENTIONS: ReadonlySet<Intervention> =
  new Set<Intervention>([
    "REQUEST_INSTRUMENT_UPDATE",
    "REQUEST_REAUTHORIZATION",
    "NUDGE_THEN_RETRY",
  ]);

const MONEY_MOVING_INTERVENTIONS: ReadonlySet<Intervention> =
  new Set<Intervention>([
    "RETRY_NOW",
    "RETRY_SCHEDULED",
    "RETRY_ALTERNATE_RAIL",
    "RETRY_SPLIT_AMOUNT",
    "NUDGE_THEN_RETRY",
  ]);

/**
 * Returns true when the intervention consumes a charge attempt.
 *
 * This distinction is important:
 *
 * - requesting a card update does not charge
 * - escalating to a human does not charge
 * - reconciling a timeout does not charge
 * - actually attempting payment does charge
 */
export function consumesChargeAttempt(
  intervention: Intervention,
): boolean {
  return CHARGE_ATTEMPT_INTERVENTIONS.has(intervention);
}

/**
 * Returns true when the action contacts the customer.
 */
export function contactsCustomer(
  intervention: Intervention,
): boolean {
  return CUSTOMER_CONTACT_INTERVENTIONS.has(intervention);
}

/**
 * Returns true when the action can actually move money.
 */
export function movesMoney(
  intervention: Intervention,
): boolean {
  return MONEY_MOVING_INTERVENTIONS.has(intervention);
}

/**
 * A small helper used by several guardrails.
 */
function hasAlternateRail(
  payment: FailedPayment,
): boolean {
  return payment.customer.availableMethods.some(
    (method) => method !== payment.method,
  );
}

/**
 * Validate the basic structural consistency of a decision.
 *
 * These checks are deliberately independent of the decline code.
 */
function checkDecisionShape(
  payment: FailedPayment,
  decision: Decision,
  blockedBy: string[],
  notes: string[],
): void {
  if (decision.paymentId !== payment.id) {
    blockedBy.push("PAYMENT_ID_MISMATCH");
    notes.push(
      "The decision refers to a different payment.",
    );
  }

  if (
    decision.intervention ===
      "RETRY_ALTERNATE_RAIL" &&
    decision.switchToMethod === null
  ) {
    blockedBy.push("ALTERNATE_RAIL_NOT_SPECIFIED");
    notes.push(
      "An alternate-rail retry must specify the rail to use.",
    );
  }

  if (
    decision.intervention ===
      "RETRY_ALTERNATE_RAIL" &&
    decision.switchToMethod !== null &&
    decision.switchToMethod === payment.method
  ) {
    blockedBy.push("ALTERNATE_RAIL_EQUALS_PRIMARY");
    notes.push(
      "The alternate rail must differ from the failed payment method.",
    );
  }

  if (
    decision.intervention ===
      "RETRY_SPLIT_AMOUNT" &&
    decision.splitAmountPaise === null
  ) {
    blockedBy.push("SPLIT_AMOUNT_NOT_SPECIFIED");
    notes.push(
      "A split-payment retry must specify the amount to charge.",
    );
  }

  if (
    decision.intervention ===
      "RETRY_SPLIT_AMOUNT" &&
    decision.splitAmountPaise !== null &&
    decision.splitAmountPaise <= 0
  ) {
    blockedBy.push("INVALID_SPLIT_AMOUNT");
    notes.push(
      "A split amount must be greater than zero.",
    );
  }

  if (
    decision.intervention ===
      "RETRY_SPLIT_AMOUNT" &&
    decision.splitAmountPaise !== null &&
    decision.splitAmountPaise >= payment.amountPaise
  ) {
    blockedBy.push("SPLIT_AMOUNT_NOT_A_SPLIT");
    notes.push(
      "A split retry must charge less than the original amount.",
    );
  }

  if (
    decision.intervention ===
      "RETRY_SCHEDULED" &&
    decision.scheduledFor === null
  ) {
    blockedBy.push("SCHEDULE_REQUIRED");
    notes.push(
      "A scheduled retry must specify when it should run.",
    );
  }

  if (
    decision.intervention !==
      "RETRY_SCHEDULED" &&
    decision.intervention !==
      "NUDGE_THEN_RETRY" &&
    decision.scheduledFor !== null
  ) {
    notes.push(
      "A scheduled timestamp was supplied for a non-scheduled intervention.",
    );
  }
}

/**
 * Hard safety rules that apply regardless of what the policy recommends.
 */
function checkUniversalStops(
  payment: FailedPayment,
  decision: Decision,
  blockedBy: string[],
  notes: string[],
): void {
  if (payment.customer.hasOpenDispute) {
    blockedBy.push("OPEN_DISPUTE");
    notes.push(
      "Recovery is frozen while an open dispute exists.",
    );
  }

  if (
    payment.customer.contactOptOut &&
    contactsCustomer(decision.intervention)
  ) {
    blockedBy.push("CUSTOMER_CONTACT_OPT_OUT");
    notes.push(
      "The customer has opted out of contact.",
    );
  }

  /**
   * An unresolved timeout represents an absence of information.
   *
   * It must never directly authorize another charge.
   */
  if (
    payment.declineCode === "GATEWAY_TIMEOUT" &&
    decision.intervention !==
      "RECONCILE_THEN_DECIDE"
  ) {
    blockedBy.push("UNRECONCILED_GATEWAY_TIMEOUT");
    notes.push(
      "An indeterminate gateway result must be reconciled before another charge attempt.",
    );
  }

  /**
   * Reconciliation itself is not a payment attempt.
   */
  if (
    decision.intervention ===
      "RECONCILE_THEN_DECIDE" &&
    payment.declineCode !==
      "GATEWAY_TIMEOUT"
  ) {
    blockedBy.push("UNNECESSARY_RECONCILIATION");
    notes.push(
      "Reconciliation is only required for an indeterminate gateway result.",
    );
  }
}

/**
 * Enforce the attempt ceiling defined by the decline taxonomy.
 */
function checkAttemptBudget(
  payment: FailedPayment,
  decision: Decision,
  blockedBy: string[],
  notes: string[],
): void {
  if (!consumesChargeAttempt(decision.intervention)) {
    return;
  }

  const profile = getDeclineProfile(
    payment.declineCode,
  );

  if (
    payment.attemptsSoFar >=
    profile.maxChargeAttempts
  ) {
    blockedBy.push("ATTEMPT_CEILING");
    notes.push(
      `The payment has already used ${payment.attemptsSoFar} charge attempts; the policy ceiling is ${profile.maxChargeAttempts}.`,
    );
  }
}

/**
 * Enforce the decline-code-specific action policy.
 */
function checkDeclinePolicy(
  payment: FailedPayment,
  decision: Decision,
  blockedBy: string[],
  notes: string[],
): void {
  const profile = getDeclineProfile(
    payment.declineCode,
  );

  /**
   * The taxonomy owns the hard action whitelist.
   */
  if (
    !profile.allowedInterventions.includes(
      decision.intervention,
    )
  ) {
    blockedBy.push(
      "INTERVENTION_NOT_ALLOWED_FOR_DECLINE",
    );

    notes.push(
      `${decision.intervention} is not permitted for ${payment.declineCode}.`,
    );
  }
}

/**
 * Alternate-rail-specific safety checks.
 */
function checkAlternateRail(
  payment: FailedPayment,
  decision: Decision,
  blockedBy: string[],
  notes: string[],
): void {
  if (
    decision.intervention !==
    "RETRY_ALTERNATE_RAIL"
  ) {
    return;
  }

  if (!hasAlternateRail(payment)) {
    blockedBy.push("NO_ALTERNATE_RAIL");
    notes.push(
      "No alternative payment method is available.",
    );
    return;
  }

  if (
    decision.switchToMethod === null
  ) {
    return;
  }

  if (
    !payment.customer.availableMethods.includes(
      decision.switchToMethod,
    )
  ) {
    blockedBy.push(
      "ALTERNATE_RAIL_NOT_AVAILABLE",
    );

    notes.push(
      "The selected alternate rail is not available for this customer.",
    );
  }
}

/**
 * Mandate-specific protection.
 *
 * Subscription renewals are backed by a mandate and therefore
 * cannot exceed the mandate ceiling.
 */
function checkMandateCeiling(
  payment: FailedPayment,
  decision: Decision,
  blockedBy: string[],
  notes: string[],
): void {
  if (
    payment.chargeKind !==
    "subscription_renewal"
  ) {
    return;
  }

  if (
    payment.mandateCeilingPaise === null
  ) {
    blockedBy.push("MANDATE_INFORMATION_MISSING");

    notes.push(
      "A subscription renewal cannot proceed without mandate information.",
    );

    return;
  }

  if (
    decision.intervention ===
    "RETRY_SPLIT_AMOUNT"
  ) {
    const split =
      decision.splitAmountPaise;

    if (
      split !== null &&
      split > payment.mandateCeilingPaise
    ) {
      blockedBy.push(
        "MANDATE_CEILING_EXCEEDED",
      );

      notes.push(
        "The proposed split charge exceeds the mandate ceiling.",
      );
    }

    return;
  }

  if (
    consumesChargeAttempt(
      decision.intervention,
    ) &&
    payment.amountPaise >
      payment.mandateCeilingPaise
  ) {
    blockedBy.push(
      "MANDATE_CEILING_EXCEEDED",
    );

    notes.push(
      "The requested charge exceeds the mandate ceiling.",
    );
  }
}

/**
 * Split-payment safety checks.
 */
function checkSplitAmount(
  payment: FailedPayment,
  decision: Decision,
  blockedBy: string[],
  notes: string[],
): void {
  if (
    decision.intervention !==
    "RETRY_SPLIT_AMOUNT"
  ) {
    return;
  }

  const split =
    decision.splitAmountPaise;

  if (split === null) {
    return;
  }

  if (
    split >= payment.amountPaise
  ) {
    blockedBy.push(
      "INVALID_SPLIT_AMOUNT",
    );

    notes.push(
      "The split amount must be smaller than the original amount.",
    );
  }

  if (
    !Number.isInteger(split)
  ) {
    blockedBy.push(
      "NON_INTEGER_PAISE_AMOUNT",
    );

    notes.push(
      "Money values must be integer paise.",
    );
  }
}

/**
 * Validate a proposed decision.
 *
 * This is the single entry point used by the orchestrator.
 *
 * It deliberately returns a complete explanation instead of throwing,
 * because a blocked AI decision is an expected business outcome and must
 * appear in the audit trail.
 */
export function evaluateGuardrails(
  payment: FailedPayment,
  decision: Decision,
): GuardrailVerdict {
  const blockedBy: string[] = [];
  const notes: string[] = [];

  checkDecisionShape(
    payment,
    decision,
    blockedBy,
    notes,
  );

  checkUniversalStops(
    payment,
    decision,
    blockedBy,
    notes,
  );

  checkAttemptBudget(
    payment,
    decision,
    blockedBy,
    notes,
  );

  checkDeclinePolicy(
    payment,
    decision,
    blockedBy,
    notes,
  );

  checkAlternateRail(
    payment,
    decision,
    blockedBy,
    notes,
  );

  checkMandateCeiling(
    payment,
    decision,
    blockedBy,
    notes,
  );

  checkSplitAmount(
    payment,
    decision,
    blockedBy,
    notes,
  );

  return {
    allowed: blockedBy.length === 0,
    blockedBy,
    notes,
  };
}

/**
 * Convenience helper for the common case where the caller only needs
 * to know whether an action can proceed.
 */
export function isDecisionAllowed(
  payment: FailedPayment,
  decision: Decision,
): boolean {
  return evaluateGuardrails(
    payment,
    decision,
  ).allowed;
}

/**
 * Return a stable human-readable summary for the audit trail.
 */
export function explainGuardrailVerdict(
  verdict: GuardrailVerdict,
): string {
  if (verdict.allowed) {
    return "Allowed by deterministic guardrails.";
  }

  return `Blocked by: ${verdict.blockedBy.join(", ")}.`;
}