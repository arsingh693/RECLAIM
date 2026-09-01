/**
 * Invariant checks over the decline taxonomy and action catalog.
 *
 * The constraints in src/domain are data, which makes them easy to read and
 * easy to get subtly wrong. These checks encode the properties that must hold
 * across the whole table, so a contradictory rule fails the build instead of
 * surfacing as strange behaviour halfway through a batch run.
 *
 * This exists because the first version of the taxonomy really did contain a
 * contradiction: CARD_EXPIRED was marked non-retryable while simultaneously
 * permitting a rail switch, which is itself a charge attempt. See the note at
 * the top of declineCodes.ts.
 *
 * Run with: npm run check
 */

import {
  ALL_DECLINE_CODES,
  getDeclineProfile,
} from "../src/domain/declineCodes";
import {
  ALL_INTERVENTIONS,
  getInterventionProfile,
} from "../src/domain/interventions";
import type { Intervention } from "../src/domain/types";

const failures: string[] = [];
const fail = (code: string, message: string): void => {
  failures.push(`${code}: ${message}`);
};

/**
 * Actions that re-present the charge on the instrument that just failed.
 * Derived rather than hardcoded, so adding a new money-moving action can't
 * silently escape this rule. RETRY_ALTERNATE_RAIL is excluded because by
 * definition it uses a different instrument.
 */
const SAME_INSTRUMENT_CHARGE_ACTIONS: readonly Intervention[] =
  ALL_INTERVENTIONS.filter((i) => {
    const p = getInterventionProfile(i);
    return p.movesMoney && p.consumesAttempt && i !== "RETRY_ALTERNATE_RAIL";
  });

for (const code of ALL_DECLINE_CODES) {
  const profile = getDeclineProfile(code);

  // 1. Every listed action must exist in the catalog.
  for (const intervention of profile.allowedInterventions) {
    try {
      getInterventionProfile(intervention);
    } catch {
      fail(code, `allows unknown intervention "${intervention}"`);
    }
  }

  // 2. No duplicates — a duplicated entry usually means a careless edit.
  const unique = new Set(profile.allowedInterventions);
  if (unique.size !== profile.allowedInterventions.length) {
    fail(code, "allowedInterventions contains duplicates");
  }

  const consumers = profile.allowedInterventions.filter(
    (i) => getInterventionProfile(i).consumesAttempt,
  );

  // 3. A zero ceiling must permit no attempt-consuming action at all.
  if (profile.maxChargeAttempts === 0 && consumers.length > 0) {
    fail(
      code,
      `maxChargeAttempts is 0 but permits attempt-consuming actions: ${consumers.join(", ")}`,
    );
  }

  // 4. Conversely, permitting charge attempts requires a non-zero ceiling.
  if (profile.maxChargeAttempts > 0 && consumers.length === 0) {
    fail(
      code,
      `maxChargeAttempts is ${profile.maxChargeAttempts} but no permitted action ever ` +
        `consumes an attempt — the ceiling is meaningless and misleading`,
    );
  }

  // 5. Not retryable on the same instrument means no same-instrument charge.
  //    This is the invariant the original bug violated.
  if (!profile.sameInstrumentRetryable) {
    const violations = profile.allowedInterventions.filter((i) =>
      SAME_INSTRUMENT_CHARGE_ACTIONS.includes(i),
    );
    if (violations.length > 0) {
      fail(
        code,
        `sameInstrumentRetryable is false but permits same-instrument charge ` +
          `actions: ${violations.join(", ")}`,
      );
    }
  }

  // 6. There must always be a way out. A code with no terminal action could
  //    leave a payment cycling forever.
  const hasExit =
    profile.allowedInterventions.includes("STOP_PERMANENT") ||
    profile.allowedInterventions.includes("ESCALATE_HUMAN");
  if (!hasExit) {
    fail(code, "permits neither STOP_PERMANENT nor ESCALATE_HUMAN — no terminal state");
  }

  // 7. An unknown outcome must force reconciliation before anything else.
  if (profile.outcomeAmbiguous) {
    if (!profile.allowedInterventions.includes("RECONCILE_THEN_DECIDE")) {
      fail(
        code,
        "outcomeAmbiguous is true but RECONCILE_THEN_DECIDE is not permitted — " +
          "this risks double-charging",
      );
    }
    const moneyMovers = profile.allowedInterventions.filter(
      (i) => getInterventionProfile(i).movesMoney,
    );
    if (moneyMovers.length > 0) {
      fail(
        code,
        `outcomeAmbiguous is true but permits immediate money movement: ` +
          `${moneyMovers.join(", ")}. Reconciliation must come first.`,
      );
    }
  }

  // 8. If only the customer can fix it, we must be allowed to ask them.
  if (profile.requiresCustomerAction) {
    const canAsk = profile.allowedInterventions.some(
      (i) => getInterventionProfile(i).contactsCustomer,
    );
    if (!canAsk) {
      fail(
        code,
        "requiresCustomerAction is true but no permitted action contacts the " +
          "customer — recovery would be impossible by construction",
      );
    }
  }

  // 9. Risk blocks must never contact the customer. They may be compromised.
  if (profile.category === "risk") {
    const contacts = profile.allowedInterventions.filter(
      (i) => getInterventionProfile(i).contactsCustomer,
    );
    if (contacts.length > 0) {
      fail(
        code,
        `risk-category code permits customer contact: ${contacts.join(", ")}`,
      );
    }
  }

  // 10. Every action needing a parameter must be reachable with one. This is a
  //     reminder to the executor, checked at decision time — here we only assert
  //     the profile flags are self-consistent.
  if (profile.rationale.trim().length < 40) {
    fail(code, "rationale is too thin to be useful in the prompt or to a reviewer");
  }
}

// Catalog-level checks.
for (const intervention of ALL_INTERVENTIONS) {
  const p = getInterventionProfile(intervention);
  if (p.contactsCustomer && p.reversible) {
    fail(
      intervention,
      "marked as contacting the customer AND reversible — a sent message " +
        "cannot be recalled",
    );
  }
  if (!p.movesMoney && p.consumesAttempt) {
    fail(
      intervention,
      "consumes a charge attempt without moving money — attempts should only " +
        "be spent on actual charge attempts",
    );
  }
}

// Every action in the catalog should be reachable from at least one code,
// otherwise it's dead code pretending to be a capability.
for (const intervention of ALL_INTERVENTIONS) {
  const reachable = ALL_DECLINE_CODES.some((code) =>
    getDeclineProfile(code).allowedInterventions.includes(intervention),
  );
  if (!reachable) {
    fail(intervention, "is in the catalog but no decline code permits it");
  }
}

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} invariant violation(s):\n`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error("");
  process.exit(1);
}

console.log(
  `✓ taxonomy invariants hold — ${ALL_DECLINE_CODES.length} decline codes, ` +
    `${ALL_INTERVENTIONS.length} interventions`,
);
