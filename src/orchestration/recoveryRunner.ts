import type {
  AttemptOutcome,
  Decision,
  FailedPayment,
} from "../domain/types";

import {
  decideWithAgent,
} from "../ai/decisionAgent";

import type {
  AIProvider,
} from "../ai/types";

import type {
  PaymentGateway,
} from "../gateway/types";

import {
  executeDecision,
} from "./executor";

import {
  AuditTrail,
  validateAuditTrail,
} from "./audit";

import {
  getCandidateActions,
} from "../policy/candidateActions";

/**
 * Complete recovery result for one payment.
 *
 * Unlike orchestratePayment(), this represents a MULTI-STEP recovery
 * lifecycle rather than a single decision.
 */
export interface RecoveryRunResult {
  readonly payment: FailedPayment;

  /**
   * Final state of the payment after the recovery run.
   *
   * This is the latest domain representation known to RECLAIM.
   */
  readonly finalPayment: FailedPayment;

  /**
   * Every gateway attempt produced during the recovery run.
   *
   * A reconciliation operation is not itself a charge attempt and therefore
   * does not appear in this array.
   */
  readonly outcomes: readonly AttemptOutcome[];

  /**
   * Number of times the decision engine was invoked.
   */
  readonly decisionsMade: number;

  /**
   * Number of decisions that were blocked by deterministic guardrails.
   */
  readonly guardrailBlocks: number;

  /**
   * Number of decisions that came from deterministic fallback rather than
   * the configured AI provider.
   */
  readonly aiFallbacks: number;

  /**
   * Number of transitions that escalated to a human.
   */
  readonly humanEscalations: number;

  /**
   * Structured append-only audit trail.
   */
  readonly auditTrail: ReturnType<
    AuditTrail["snapshot"]
  >;

  /**
   * Why the recovery loop stopped.
   */
  readonly stopReason:
    | "RECOVERED"
    | "PERMANENT_STOP"
    | "HUMAN_ESCALATION"
    | "NO_ACTION"
    | "RECONCILIATION_FAILED"
    | "RECONCILIATION_STILL_UNKNOWN"
    | "MAX_TRANSITIONS";
}

export interface RecoveryRunnerOptions {
  readonly gateway: PaymentGateway;
  readonly aiProvider: AIProvider;

  /**
   * Defensive state-transition ceiling.
   *
   * This is NOT the payment-attempt ceiling. The taxonomy/guardrails own
   * charge-attempt limits.
   *
   * This simply prevents a programming or provider error from producing
   * an infinite orchestration loop.
   */
  readonly maxTransitions?: number;
}

/**
 * Run the complete adaptive recovery lifecycle for one payment.
 *
 * Core invariant:
 *
 *     The decision engine may recommend.
 *     Guardrails authorize.
 *     Executor executes.
 *     Gateway moves money.
 *
 * No decision is allowed to bypass the guardrail/executor boundary.
 */
export async function runRecovery(
  payment: FailedPayment,
  options: RecoveryRunnerOptions,
): Promise<RecoveryRunResult> {
  const auditTrail =
    new AuditTrail();

  const outcomes: AttemptOutcome[] = [];

  let currentPayment = payment;

  let decisionsMade = 0;
  let guardrailBlocks = 0;
  let aiFallbacks = 0;
  let humanEscalations = 0;

  const maxTransitions =
    options.maxTransitions ?? 8;

  for (
    let transition = 0;
    transition < maxTransitions;
    transition += 1
  ) {
    /**
     * Obtain the deterministic candidate space first.
     *
     * This happens independently of the AI provider.
     */
    const candidateActions =
      getCandidateActions(
        currentPayment,
      );

    /**
     * If the taxonomy somehow produces no actions, stop safely.
     */
    if (
      candidateActions.length === 0
    ) {
      return finish(
        payment,
        currentPayment,
        outcomes,
        decisionsMade,
        guardrailBlocks,
        aiFallbacks,
        humanEscalations,
        auditTrail,
        "NO_ACTION",
      );
    }

    /**
     * Ask the configured provider to choose among the permitted candidates.
     *
     * The provider can be Gemini or the deterministic stub.
     */
    const agentResult =
      await decideWithAgent(
        currentPayment,
        {
          provider:
            options.aiProvider,
          fallbackIntervention:
            chooseFallbackIntervention(
              currentPayment,
            ),
        },
      );

    decisionsMade += 1;

    if (
      agentResult.fallbackUsed
    ) {
      aiFallbacks += 1;
    }

    const intervention =
      agentResult.intervention ??
      chooseFallbackIntervention(
        currentPayment,
      );

    /**
     * Handle reconciliation BEFORE creating a normal charge decision.
     *
     * A timeout means the payment state is unknown.
     * It must not be converted into another charge until reconciliation
     * establishes what actually happened.
     */
    if (
      intervention ===
      "RECONCILE_THEN_DECIDE"
    ) {
      const decision =
        buildDecision(
          currentPayment,
          agentResult,
          intervention,
        );

      const execution =
        await executeDecision(
          currentPayment,
          decision,
          {
            gateway:
              options.gateway,
          },
        );

      /**
       * executeDecision correctly does not charge for reconciliation.
       * We therefore perform reconciliation explicitly here.
       */
      const reconciliation =
        await options.gateway.reconcile({
          paymentId:
            currentPayment.id,
        });

      /**
       * Record the reconciliation decision in the audit trail.
       *
       * The decision itself did not produce a charge outcome.
       */
      auditTrail.append(
        currentPayment,
        decision,
        execution.guardrail,
        null,
      );

      if (
        !execution.guardrail.allowed
      ) {
        guardrailBlocks += 1;

        return finish(
          payment,
          currentPayment,
          outcomes,
          decisionsMade,
          guardrailBlocks,
          aiFallbacks,
          humanEscalations,
          auditTrail,
          "RECONCILIATION_FAILED",
        );
      }

      /**
       * Gateway explicitly confirms the payment succeeded.
       */
      if (
        reconciliation.status ===
          "captured" &&
        reconciliation.outcome?.succeeded
      ) {
        outcomes.push(
          reconciliation.outcome,
        );

        return finish(
          payment,
          currentPayment,
          outcomes,
          decisionsMade,
          guardrailBlocks,
          aiFallbacks,
          humanEscalations,
          auditTrail,
          "RECOVERED",
        );
      }

      /**
       * Gateway explicitly confirms that the payment failed.
       *
       * Reconciliation itself consumes no charge attempt.
       * We update the domain state and allow the next transition
       * to choose an appropriate recovery action.
       */
      if (
        reconciliation.status ===
          "failed" &&
        reconciliation.outcome?.declineCode
      ) {
        currentPayment =
          {
            ...currentPayment,
            declineCode:
              reconciliation.outcome
                .declineCode,
            gatewayRawReason:
              `Reconciled gateway failure: ${reconciliation.outcome.declineCode}`,
          };

        continue;
      }

      /**
       * We still don't know what happened.
       *
       * Never guess. Never charge again.
       */
      return finish(
        payment,
        currentPayment,
        outcomes,
        decisionsMade,
        guardrailBlocks,
        aiFallbacks,
        humanEscalations,
        auditTrail,
        "RECONCILIATION_STILL_UNKNOWN",
      );
    }

    const decision =
      buildDecision(
        currentPayment,
        agentResult,
        intervention,
      );

    const execution =
      await executeDecision(
        currentPayment,
        decision,
        {
          gateway:
            options.gateway,
        },
      );

    /**
     * Every decision is audited, including blocked decisions and
     * non-charge interventions.
     */
    auditTrail.append(
      currentPayment,
      decision,
      execution.guardrail,
      execution.outcome,
    );

    if (
      !execution.guardrail.allowed
    ) {
      guardrailBlocks += 1;

      /**
       * A guardrail block is not something to blindly retry.
       * The deterministic safety boundary has explicitly rejected
       * the requested action.
       *
       * Stop this recovery run rather than creating a loop.
       */
      return finish(
        payment,
        currentPayment,
        outcomes,
        decisionsMade,
        guardrailBlocks,
        aiFallbacks,
        humanEscalations,
        auditTrail,
        "NO_ACTION",
      );
    }

    /**
     * Non-charge interventions such as instrument update,
     * reauthorization, and human escalation do not produce a gateway
     * outcome immediately.
     */
    if (
      !execution.executed
    ) {
      if (
        intervention ===
        "ESCALATE_HUMAN"
      ) {
        humanEscalations += 1;

        return finish(
          payment,
          currentPayment,
          outcomes,
          decisionsMade,
          guardrailBlocks,
          aiFallbacks,
          humanEscalations,
          auditTrail,
          "HUMAN_ESCALATION",
        );
      }

      if (
        intervention ===
        "STOP_PERMANENT"
      ) {
        return finish(
          payment,
          currentPayment,
          outcomes,
          decisionsMade,
          guardrailBlocks,
          aiFallbacks,
          humanEscalations,
          auditTrail,
          "PERMANENT_STOP",
        );
      }

      /**
       * A customer-facing action requires an external event before the
       * next payment attempt can legitimately occur.
       *
       * We do not fake that event.
       */
      return finish(
        payment,
        currentPayment,
        outcomes,
        decisionsMade,
        guardrailBlocks,
        aiFallbacks,
        humanEscalations,
        auditTrail,
        "NO_ACTION",
      );
    }

    if (
      execution.outcome ===
      null
    ) {
      return finish(
        payment,
        currentPayment,
        outcomes,
        decisionsMade,
        guardrailBlocks,
        aiFallbacks,
        humanEscalations,
        auditTrail,
        "NO_ACTION",
      );
    }

    const outcome =
      execution.outcome;

    outcomes.push(outcome);

    /**
     * Successful recovery ends the lifecycle immediately.
     *
     * Continuing after a successful charge could double-charge the payer.
     */
    if (
      outcome.succeeded
    ) {
      return finish(
        payment,
        currentPayment,
        outcomes,
        decisionsMade,
        guardrailBlocks,
        aiFallbacks,
        humanEscalations,
        auditTrail,
        "RECOVERED",
      );
    }

    /**
     * Indeterminate result:
     *
     * Do NOT treat it as a normal decline.
     * Update the payment state to GATEWAY_TIMEOUT so the next
     * transition is forced through reconciliation.
     */
    if (
      outcome.indeterminate
    ) {
      currentPayment =
        {
          ...currentPayment,
          declineCode:
            "GATEWAY_TIMEOUT",
          gatewayRawReason:
            "Gateway returned an indeterminate result; reconciliation required.",
          /**
           * The charge attempt occurred, so it counts toward the
           * logical attempt history.
           */
          attemptsSoFar:
            currentPayment.attemptsSoFar +
            1,
        };

      continue;
    }

    /**
     * Deterministic decline.
     *
     * The attempt occurred, so increment the attempt counter before
     * asking the policy what to do next.
     */
    currentPayment =
      {
        ...currentPayment,
        declineCode:
          outcome.declineCode ??
          currentPayment.declineCode,
        gatewayRawReason:
          outcome.declineCode
            ? `Recovery attempt declined: ${outcome.declineCode}`
            : currentPayment.gatewayRawReason,
        attemptsSoFar:
          currentPayment.attemptsSoFar +
          1,
    };

    /**
     * If this was the last permitted charge attempt, the next policy
     * transition can only select non-charge or terminal actions because
     * candidateActions + guardrails enforce the ceiling.
     *
     * We continue the loop so that the system can produce an explicit
     * escalation/stop decision rather than silently ending.
     */
  }

  return finish(
    payment,
    currentPayment,
    outcomes,
    decisionsMade,
    guardrailBlocks,
    aiFallbacks,
    humanEscalations,
    auditTrail,
    "MAX_TRANSITIONS",
  );
}

/**
 * Construct an executable domain Decision from the agent result.
 *
 * Timing, alternate rail, and split amount are resolved deterministically.
 * The AI cannot directly set execution parameters.
 */
export function buildDecision(
  payment: FailedPayment,
  agentResult: Awaited<
    ReturnType<typeof decideWithAgent>
  >,
  intervention: Decision["intervention"],
): Decision {
  return {
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
}

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
    delayHours = 48;
  }

  /*
   * Recovery may be evaluated long after the original failure.
   * Never produce a schedule in the past.
   *
   * We preserve the original failure time when it is recent enough,
   * otherwise schedule relative to the current evaluation time.
   */
  const schedulingBase =
    Math.max(
      failedAt,
      Date.now(),
    );

  return new Date(
    schedulingBase +
      delayHours *
        60 *
        60 *
        1000,
  ).toISOString();
}

function buildAlternateRail(
  payment: FailedPayment,
  intervention: Decision["intervention"],
): FailedPayment["method"] | null {
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

function chooseFallbackIntervention(
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

    case "CARD_BLOCKED":
      return "REQUEST_INSTRUMENT_UPDATE";

    case "DO_NOT_HONOUR":
      return "ESCALATE_HUMAN";

    case "MANDATE_PAUSED":
    case "MANDATE_LIMIT_EXCEEDED":
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

function finish(
  payment: FailedPayment,
  finalPayment: FailedPayment,
  outcomes: readonly AttemptOutcome[],
  decisionsMade: number,
  guardrailBlocks: number,
  aiFallbacks: number,
  humanEscalations: number,
  auditTrail: AuditTrail,
  stopReason: RecoveryRunResult["stopReason"],
): RecoveryRunResult {
  const snapshot =
    auditTrail.snapshot();

  validateAuditTrail(
    snapshot,
  );

  return {
    payment,
    finalPayment,
    outcomes,
    decisionsMade,
    guardrailBlocks,
    aiFallbacks,
    humanEscalations,
    auditTrail:
      snapshot,
    stopReason,
  };
}