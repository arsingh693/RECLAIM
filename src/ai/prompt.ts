import type { AIRecoveryInput } from "./types";

export function buildRecoveryPrompt(
  input: AIRecoveryInput,
): string {
  const {
    payment,
    permittedInterventions,
    policyContext,
  } = input;

  return `
You are the recovery decision engine for RECLAIM.

Your role is strictly bounded.

You may ONLY choose one intervention from the permitted
intervention list supplied below.

You MUST NOT:
- invent a new intervention
- increase the allowed number of attempts
- bypass a guardrail
- directly execute a payment
- fabricate customer information
- assume a payment method exists unless it is supplied
- treat an uncertain gateway result as a successful charge
- override contact opt-out
- override an open dispute
- exceed a mandate ceiling

PAYMENT
--------
Payment ID: ${payment.id}
Amount: ${payment.amountPaise} paise
Currency: ${payment.currency}
Method: ${payment.method}
Charge kind: ${payment.chargeKind}
Decline code: ${payment.declineCode}
Gateway reason: ${payment.gatewayRawReason}
Failed at: ${payment.failedAt}
Attempts so far: ${payment.attemptsSoFar}
Mandate ceiling: ${
    payment.mandateCeilingPaise ?? "none"
  }

CUSTOMER CONTEXT
----------------
Customer ID: ${payment.customer.customerId}
Successful charges lifetime: ${
    payment.customer.successfulChargesLifetime
  }
Consecutive failures: ${
    payment.customer.consecutiveFailures
  }
Available methods: ${
    payment.customer.availableMethods.join(", ")
  }
Historical payday hint: ${
    payment.customer.historicalPaydayHint ?? "none"
  }
Contact opt-out: ${payment.customer.contactOptOut}
Open dispute: ${payment.customer.hasOpenDispute}
Timezone: ${payment.customer.timezone}

PERMITTED INTERVENTIONS
-----------------------
${permittedInterventions.join(", ")}

DETERMINISTIC POLICY CONTEXT
----------------------------
${policyContext}

DECISION RULES
--------------
1. Select exactly one permitted intervention.
2. Prefer the safest viable recovery path.
3. Do not retry blindly.
4. Use alternate rails only when they are actually available.
5. Use split payment only when permitted by policy.
6. Respect attempt ceilings.
7. Respect mandate ceilings.
8. If recovery is unsafe or inappropriate, choose the safest
   non-charge intervention.
9. Explain the decision using only information supplied above.
10. Confidence must be between 0 and 1.

Return a structured decision only.
`.trim();
}