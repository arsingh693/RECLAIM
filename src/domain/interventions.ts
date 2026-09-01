/**
 * The action catalog.
 *
 * This is the complete set of things the system can do to a payment. It is
 * closed on purpose — a recovery agent that can invent new actions is a
 * recovery agent nobody can sign off on.
 *
 * The flags on each action are what the guardrail layer reasons about. It never
 * needs to understand what an action *means*, only whether this action, with
 * these properties, is permitted for this payment right now.
 */

import type { Intervention } from "./types";

export interface InterventionProfile {
  readonly intervention: Intervention;
  readonly label: string;
  /** Will this attempt to take money from the customer? */
  readonly movesMoney: boolean;
  /** Will this send the customer a message? Subject to quiet hours and opt-out. */
  readonly contactsCustomer: boolean;
  /**
   * Can the effect be undone before the customer notices?
   * A queued retry can be cancelled. A sent SMS cannot be unsent. A completed
   * charge can be refunded, but the customer has already seen the debit, so we
   * do not count that as reversible.
   */
  readonly reversible: boolean;
  /** Decision must carry a `scheduledFor`. */
  readonly requiresSchedule: boolean;
  /** Decision must carry a `switchToMethod` the customer actually has on file. */
  readonly requiresAlternateMethod: boolean;
  /** Decision must carry a `splitAmountPaise` at or below every applicable cap. */
  readonly requiresSplitAmount: boolean;
  /** Consumes one of the payment's permitted attempts. */
  readonly consumesAttempt: boolean;
  readonly description: string;
}

const PROFILES: Record<Intervention, InterventionProfile> = {
  RETRY_NOW: {
    intervention: "RETRY_NOW",
    label: "Retry immediately",
    movesMoney: true,
    contactsCustomer: false,
    reversible: false,
    requiresSchedule: false,
    requiresAlternateMethod: false,
    requiresSplitAmount: false,
    consumesAttempt: true,
    description:
      "Re-present the same charge on the same rail right now. Only correct when " +
      "the failure was transient infrastructure — for anything else this is the " +
      "action that wastes attempts.",
  },

  RETRY_SCHEDULED: {
    intervention: "RETRY_SCHEDULED",
    label: "Retry at a chosen time",
    movesMoney: true,
    contactsCustomer: false,
    reversible: true,
    requiresSchedule: true,
    requiresAlternateMethod: false,
    requiresSplitAmount: false,
    consumesAttempt: true,
    description:
      "Queue the same charge for a specific moment — typically a payday, or " +
      "after a daily limit window resets. The timing is the entire value of " +
      "this action, so a decision choosing it must justify the chosen time.",
  },

  RETRY_ALTERNATE_RAIL: {
    intervention: "RETRY_ALTERNATE_RAIL",
    label: "Retry on a different payment method",
    movesMoney: true,
    contactsCustomer: false,
    reversible: false,
    requiresSchedule: false,
    requiresAlternateMethod: true,
    requiresSplitAmount: false,
    consumesAttempt: true,
    description:
      "Re-present the charge on another method already on file — UPI when a card " +
      "fails, say. Bypasses instrument- and issuer-specific problems entirely. " +
      "Requires that the alternate method genuinely exists for this customer.",
  },

  RETRY_SPLIT_AMOUNT: {
    intervention: "RETRY_SPLIT_AMOUNT",
    label: "Retry a smaller amount",
    movesMoney: true,
    contactsCustomer: false,
    reversible: false,
    requiresSchedule: false,
    requiresAlternateMethod: false,
    requiresSplitAmount: true,
    consumesAttempt: true,
    description:
      "Charge a reduced amount that fits under the cap that blocked us — a " +
      "transaction limit, or a mandate ceiling. Partial recovery beats none, but " +
      "the split amount must respect every cap that applies.",
  },

  RECONCILE_THEN_DECIDE: {
    intervention: "RECONCILE_THEN_DECIDE",
    label: "Reconcile before doing anything",
    movesMoney: false,
    contactsCustomer: false,
    reversible: true,
    requiresSchedule: false,
    requiresAlternateMethod: false,
    requiresSplitAmount: false,
    consumesAttempt: false,
    description:
      "Ask the gateway what actually happened, then re-decide with the truth. " +
      "Read-only and free. This is the mandatory first move whenever the " +
      "original outcome is unknown, because the alternative is risking a " +
      "double charge.",
  },

  REQUEST_INSTRUMENT_UPDATE: {
    intervention: "REQUEST_INSTRUMENT_UPDATE",
    label: "Ask the customer for new payment details",
    movesMoney: false,
    contactsCustomer: true,
    reversible: false,
    requiresSchedule: false,
    requiresAlternateMethod: false,
    requiresSplitAmount: false,
    consumesAttempt: false,
    description:
      "Send a link to update the card or account. The only path when the " +
      "instrument itself is dead. Costs a customer contact, so it should not be " +
      "spent on failures that would have resolved themselves.",
  },

  REQUEST_REAUTHORIZATION: {
    intervention: "REQUEST_REAUTHORIZATION",
    label: "Ask the customer to re-authorise the mandate",
    movesMoney: false,
    contactsCustomer: true,
    reversible: false,
    requiresSchedule: false,
    requiresAlternateMethod: false,
    requiresSplitAmount: false,
    consumesAttempt: false,
    description:
      "Start a fresh mandate authorization flow. Required when the standing " +
      "authorization is gone or its ceiling is too low. Cannot be automated " +
      "away — only the customer can grant it.",
  },

  NUDGE_THEN_RETRY: {
    intervention: "NUDGE_THEN_RETRY",
    label: "Message the customer, then retry",
    movesMoney: true,
    contactsCustomer: true,
    reversible: false,
    requiresSchedule: true,
    requiresAlternateMethod: false,
    requiresSplitAmount: false,
    consumesAttempt: true,
    description:
      "Tell the customer a charge is coming so they can fund the account, then " +
      "retry after a stated delay. The expensive option: it spends both a " +
      "contact and an attempt, so it should be reserved for balances worth the " +
      "goodwill cost.",
  },

  ESCALATE_HUMAN: {
    intervention: "ESCALATE_HUMAN",
    label: "Hand to a human",
    movesMoney: false,
    contactsCustomer: false,
    reversible: true,
    requiresSchedule: false,
    requiresAlternateMethod: false,
    requiresSplitAmount: false,
    consumesAttempt: false,
    description:
      "Queue for manual review with the full context attached. The correct " +
      "answer whenever the situation exceeds what the policy is allowed to " +
      "bound — high value, risk flags, or anything genuinely ambiguous. " +
      "Escalating is a success for this system, not a failure.",
  },

  STOP_PERMANENT: {
    intervention: "STOP_PERMANENT",
    label: "Stop trying",
    movesMoney: false,
    contactsCustomer: false,
    reversible: true,
    requiresSchedule: false,
    requiresAlternateMethod: false,
    requiresSplitAmount: false,
    consumesAttempt: false,
    description:
      "Close this payment out with a recorded reason and take no further " +
      "action. Needed as an explicit, first-class choice — a recovery system " +
      "without a deliberate way to give up will grind at hopeless cases and " +
      "annoy customers on the way.",
  },
};

export const ALL_INTERVENTIONS = Object.keys(PROFILES) as Intervention[];

/** Lookup that fails loudly, for the same reason as getDeclineProfile. */
export function getInterventionProfile(
  intervention: Intervention,
): InterventionProfile {
  const profile = PROFILES[intervention];
  if (!profile) {
    throw new Error(
      `No profile for intervention "${intervention}". The action catalog is ` +
        `closed — an unlisted action must never reach execution.`,
    );
  }
  return profile;
}

/** Renders the catalog for the policy prompt, same single-source-of-truth idea. */
export function describeInterventionsForPrompt(
  interventions: readonly Intervention[],
): string {
  return interventions
    .map((i) => {
      const p = getInterventionProfile(i);
      const costs: string[] = [];
      if (p.consumesAttempt) costs.push("uses one attempt");
      if (p.contactsCustomer) costs.push("contacts the customer");
      if (!p.movesMoney && !p.contactsCustomer) costs.push("free");
      const requires: string[] = [];
      if (p.requiresSchedule) requires.push("scheduledFor");
      if (p.requiresAlternateMethod) requires.push("switchToMethod");
      if (p.requiresSplitAmount) requires.push("splitAmountPaise");
      return [
        `${p.intervention} — ${p.label}`,
        `  cost: ${costs.join(", ")}`,
        requires.length ? `  must also provide: ${requires.join(", ")}` : null,
        `  ${p.description}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}
