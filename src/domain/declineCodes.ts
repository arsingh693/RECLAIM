/**
 * The decline taxonomy.
 *
 * This file is the spine of the project. Each decline code carries *hard*
 * constraints, and the split between what's hard here and what the model
 * decides later is the central design decision:
 *
 *   - This file decides what is PERMITTED. Deterministic, auditable, no model.
 *   - The policy (src/policy) decides what is BEST among permitted options.
 *
 * The model can never widen `allowedInterventions` or exceed `maxChargeAttempts`.
 * If it tries, the guardrail layer rejects the decision and falls back. That
 * boundary is deliberate: "should we be allowed to charge this person again"
 * is not a question a language model should be answering.
 *
 * `rationale` is not decoration. It is fed verbatim into the policy prompt, so
 * the reasoning a reviewer reads here is the same reasoning the model gets.
 * One source of truth, no drift between docs and behaviour.
 *
 * ---
 * A note on the two separate limits, because conflating them was a bug:
 *
 *   `sameInstrumentRetryable` — may we re-present on the rail that just failed?
 *   `maxChargeAttempts`       — total automated charge attempts, ANY rail.
 *
 * An expired card is not retryable on the same instrument, but the customer's
 * UPI handle is a different instrument and may be worth one attempt. A risk
 * block is different in kind: no charge attempt is permitted on any rail at
 * all, so its ceiling is zero. Collapsing these into one boolean made
 * CARD_EXPIRED look like it forbade retries while simultaneously allowing a
 * rail switch. The invariants in scripts/checkInvariants.ts now make that
 * class of contradiction a build failure.
 */

import type { DeclineCode, Intervention } from "./types";

export type DeclineCategory =
  | "transient" // infrastructure, will pass on its own
  | "funding" // money isn't there right now
  | "instrument" // the card/account itself is unusable
  | "authorization" // we lack permission to charge
  | "risk" // blocked deliberately
  | "ambiguous"; // we genuinely don't know

export interface DeclineProfile {
  readonly code: DeclineCode;
  readonly label: string;
  readonly category: DeclineCategory;
  /** Hard. May we re-present the charge on the rail that just failed? */
  readonly sameInstrumentRetryable: boolean;
  /**
   * Hard ceiling on total automated charge attempts across every rail,
   * inclusive of attempts already made. Zero means no automated charge is ever
   * permitted for this code.
   */
  readonly maxChargeAttempts: number;
  /** Hard whitelist. The policy may only choose from this set. */
  readonly allowedInterventions: readonly Intervention[];
  /** Recovery is impossible without the customer doing something. */
  readonly requiresCustomerAction: boolean;
  /** We don't know if the original charge landed. Reconcile before acting. */
  readonly outcomeAmbiguous: boolean;
  /** Why these constraints. Fed to the policy prompt verbatim. */
  readonly rationale: string;
}

const PROFILES: Record<DeclineCode, DeclineProfile> = {
  INSUFFICIENT_FUNDS: {
    code: "INSUFFICIENT_FUNDS",
    label: "Insufficient funds",
    category: "funding",
    sameInstrumentRetryable: true,
    maxChargeAttempts: 3,
    allowedInterventions: [
      "RETRY_SCHEDULED",
      "NUDGE_THEN_RETRY",
      "RETRY_ALTERNATE_RAIL",
      "RETRY_SPLIT_AMOUNT",
      "ESCALATE_HUMAN",
      "STOP_PERMANENT",
    ],
    requiresCustomerAction: false,
    outcomeAmbiguous: false,
    rationale:
      "The account is empty, not broken. Recovery depends almost entirely on " +
      "timing: target a known payday, or nudge first and retry after. " +
      "RETRY_NOW is deliberately excluded — an immediate retry on an empty " +
      "account fails again and burns one of only three permitted attempts.",
  },

  CARD_EXPIRED: {
    code: "CARD_EXPIRED",
    label: "Card expired",
    category: "instrument",
    sameInstrumentRetryable: false,
    maxChargeAttempts: 1,
    allowedInterventions: [
      "REQUEST_INSTRUMENT_UPDATE",
      "RETRY_ALTERNATE_RAIL",
      "STOP_PERMANENT",
    ],
    requiresCustomerAction: true,
    outcomeAmbiguous: false,
    rationale:
      "No number of retries fixes an expired card — the failure is permanent " +
      "until the customer supplies new details. Only two paths exist: a fresh " +
      "instrument, or a different rail already on file. The single permitted " +
      "charge attempt exists solely for that rail switch.",
  },

  CARD_BLOCKED: {
    code: "CARD_BLOCKED",
    label: "Card blocked, lost or stolen",
    category: "instrument",
    sameInstrumentRetryable: false,
    maxChargeAttempts: 1,
    allowedInterventions: [
      "REQUEST_INSTRUMENT_UPDATE",
      "RETRY_ALTERNATE_RAIL",
      "ESCALATE_HUMAN",
      "STOP_PERMANENT",
    ],
    requiresCustomerAction: true,
    outcomeAmbiguous: false,
    rationale:
      "The card is dead at the issuer. Beyond being futile, repeated attempts " +
      "against a blocked card resemble card-testing behaviour and can damage " +
      "the merchant's standing with the issuer.",
  },

  ISSUER_UNAVAILABLE: {
    code: "ISSUER_UNAVAILABLE",
    label: "Issuer or bank unavailable",
    category: "transient",
    sameInstrumentRetryable: true,
    maxChargeAttempts: 4,
    allowedInterventions: [
      "RETRY_NOW",
      "RETRY_SCHEDULED",
      "RETRY_ALTERNATE_RAIL",
      "ESCALATE_HUMAN",
      "STOP_PERMANENT",
    ],
    requiresCustomerAction: false,
    outcomeAmbiguous: false,
    rationale:
      "Nothing is wrong with the customer or the instrument; the bank is down. " +
      "This is the highest-recovery, lowest-cost category in the taxonomy — a " +
      "short retry or an immediate rail switch usually works. Customer contact " +
      "is excluded entirely: a bank outage is not the customer's problem and " +
      "messaging them about it is pure cost with no recovery value.",
  },

  GATEWAY_TIMEOUT: {
    code: "GATEWAY_TIMEOUT",
    label: "Gateway timeout — outcome unknown",
    category: "ambiguous",
    sameInstrumentRetryable: false,
    maxChargeAttempts: 0,
    allowedInterventions: ["RECONCILE_THEN_DECIDE", "ESCALATE_HUMAN"],
    requiresCustomerAction: false,
    outcomeAmbiguous: true,
    rationale:
      "We never learned whether the original charge succeeded. Retrying before " +
      "reconciling risks double-charging, and double-charging a customer is a " +
      "worse outcome than failing to recover. So this code authorises no charge " +
      "attempt at all: it is not a chargeable state, it is an unresolved one. " +
      "Reconciliation collapses it into the truth — either the money already " +
      "landed and there is nothing to recover, or the charge definitively failed " +
      "with a real decline code — and the payment is then re-decided under that " +
      "code, subject to that code's own ceiling. Treating this as chargeable " +
      "would double-count the attempt budget across two states.",
  },

  LIMIT_EXCEEDED: {
    code: "LIMIT_EXCEEDED",
    label: "Transaction or daily limit exceeded",
    category: "funding",
    sameInstrumentRetryable: true,
    maxChargeAttempts: 3,
    allowedInterventions: [
      "RETRY_SPLIT_AMOUNT",
      "RETRY_SCHEDULED",
      "RETRY_ALTERNATE_RAIL",
      "NUDGE_THEN_RETRY",
      "ESCALATE_HUMAN",
      "STOP_PERMANENT",
    ],
    requiresCustomerAction: false,
    outcomeAmbiguous: false,
    rationale:
      "A cap was hit, not an empty account — the money may well be there. " +
      "Splitting the amount below the cap, or waiting for the daily window to " +
      "reset, both work. Retrying the identical amount on the same rail within " +
      "the same window cannot, so RETRY_NOW is excluded.",
  },

  DO_NOT_HONOUR: {
    code: "DO_NOT_HONOUR",
    label: "Do not honour (issuer gave no reason)",
    category: "ambiguous",
    sameInstrumentRetryable: true,
    maxChargeAttempts: 2,
    allowedInterventions: [
      "RETRY_ALTERNATE_RAIL",
      "RETRY_SCHEDULED",
      "ESCALATE_HUMAN",
      "STOP_PERMANENT",
    ],
    requiresCustomerAction: false,
    outcomeAmbiguous: false,
    rationale:
      "The single most common decline and the least informative — the issuer " +
      "refused and told us nothing. Because it cannot be diagnosed, the correct " +
      "posture is humility: a low attempt cap and an early rail switch. Pouring " +
      "attempts into an uninformative decline is the classic way retry budgets " +
      "are wasted.",
  },

  AUTHENTICATION_FAILED: {
    code: "AUTHENTICATION_FAILED",
    label: "Authentication failed (CVV, OTP or 3DS)",
    category: "instrument",
    sameInstrumentRetryable: false,
    maxChargeAttempts: 1,
    allowedInterventions: [
      "REQUEST_INSTRUMENT_UPDATE",
      "RETRY_ALTERNATE_RAIL",
      "STOP_PERMANENT",
    ],
    requiresCustomerAction: true,
    outcomeAmbiguous: false,
    rationale:
      "The customer's credentials or challenge response were wrong. An " +
      "automated retry replays the same bad input, so it cannot succeed, and " +
      "repeated authentication failures trip issuer velocity limits. The fix " +
      "has to come from the customer, or from a rail that authenticates " +
      "differently.",
  },

  MANDATE_PAUSED: {
    code: "MANDATE_PAUSED",
    label: "Mandate paused or revoked",
    category: "authorization",
    sameInstrumentRetryable: false,
    maxChargeAttempts: 0,
    allowedInterventions: [
      "REQUEST_REAUTHORIZATION",
      "ESCALATE_HUMAN",
      "STOP_PERMANENT",
    ],
    requiresCustomerAction: true,
    outcomeAmbiguous: false,
    rationale:
      "The standing authorization is gone. This is not a technical failure to " +
      "route around — charging without a live mandate would be an unauthorised " +
      "debit. Re-authorization by the customer is the only legitimate path, and " +
      "no automated charge attempt is permitted on any rail.",
  },

  MANDATE_LIMIT_EXCEEDED: {
    code: "MANDATE_LIMIT_EXCEEDED",
    label: "Charge exceeds mandate ceiling",
    category: "authorization",
    sameInstrumentRetryable: true,
    maxChargeAttempts: 2,
    allowedInterventions: [
      "RETRY_SPLIT_AMOUNT",
      "REQUEST_REAUTHORIZATION",
      "ESCALATE_HUMAN",
      "STOP_PERMANENT",
    ],
    requiresCustomerAction: false,
    outcomeAmbiguous: false,
    rationale:
      "The charge is larger than the ceiling the customer authorised. We may " +
      "charge up to that ceiling and never a paisa above it. Collecting the " +
      "remainder requires the customer to re-authorise at a higher cap.",
  },

  RISK_BLOCKED: {
    code: "RISK_BLOCKED",
    label: "Blocked by risk engine",
    category: "risk",
    sameInstrumentRetryable: false,
    maxChargeAttempts: 0,
    allowedInterventions: ["ESCALATE_HUMAN", "STOP_PERMANENT"],
    requiresCustomerAction: false,
    outcomeAmbiguous: false,
    rationale:
      "A risk system blocked this deliberately. An automated recovery agent " +
      "must never retry around a fraud block, and must never message a " +
      "potentially compromised customer. Human review or stop, nothing else. " +
      "For this code the correct recovery rate is zero, and any system that " +
      "reports recoveries here is doing something wrong.",
  },

  INVALID_INSTRUMENT: {
    code: "INVALID_INSTRUMENT",
    label: "Invalid account or VPA",
    category: "instrument",
    sameInstrumentRetryable: false,
    maxChargeAttempts: 1,
    allowedInterventions: [
      "REQUEST_INSTRUMENT_UPDATE",
      "RETRY_ALTERNATE_RAIL",
      "STOP_PERMANENT",
    ],
    requiresCustomerAction: true,
    outcomeAmbiguous: false,
    rationale:
      "The account or VPA does not exist, or cannot accept this charge. A data " +
      "problem rather than a timing problem, so waiting changes nothing.",
  },
};

export const ALL_DECLINE_CODES = Object.keys(PROFILES) as DeclineCode[];

/** Lookup that fails loudly. An unmapped code is a bug, not a default case. */
export function getDeclineProfile(code: DeclineCode): DeclineProfile {
  const profile = PROFILES[code];
  if (!profile) {
    throw new Error(
      `No decline profile for "${code}". Every code must be explicitly mapped — ` +
        `silently defaulting would let an unknown failure inherit permissive rules.`,
    );
  }
  return profile;
}

export function isInterventionAllowed(
  code: DeclineCode,
  intervention: Intervention,
): boolean {
  return getDeclineProfile(code).allowedInterventions.includes(intervention);
}

/**
 * Renders the taxonomy for the policy prompt. Because this is generated from
 * the same objects the guardrails enforce, the model is never told about an
 * option the guardrails would reject.
 */
export function describeTaxonomyForPrompt(
  codes?: readonly DeclineCode[],
): string {
  const selected = codes ?? ALL_DECLINE_CODES;
  return selected
    .map((code) => {
      const p = getDeclineProfile(code);
      return [
        `${p.code} — ${p.label}`,
        `  category: ${p.category}`,
        `  re-present on the same rail: ${p.sameInstrumentRetryable ? "allowed" : "NOT allowed"}`,
        `  total automated charge attempts permitted (any rail): ${p.maxChargeAttempts}`,
        `  permitted actions: ${p.allowedInterventions.join(", ")}`,
        p.outcomeAmbiguous
          ? `  NOTE: original outcome unknown — must reconcile before any charge`
          : null,
        p.requiresCustomerAction
          ? `  NOTE: cannot recover without customer action`
          : null,
        `  why: ${p.rationale}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}
