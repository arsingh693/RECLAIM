import {
  DecisionAgentOptions,
  AgentDecisionResult,
  AIDecisionRequest,
} from "./types";

import { validateAIResponse } from "./provider";

import {
  FailedPayment,
  Intervention,
} from "../domain/types";

import {
  getCandidateActions,
} from "../policy/candidateActions";

import {
  buildPolicyContext,
} from "../policy/decisionPolicy";

/**
 * Ask the AI provider to choose among the interventions already
 * approved by deterministic policy.
 *
 * The AI is advisory:
 *
 *     policy → AI → validation → guardrails
 *
 * It never receives authority to create a new intervention.
 */
export async function decideWithAgent(
  payment: FailedPayment,
  options: DecisionAgentOptions,
): Promise<AgentDecisionResult> {
  const interventions = getCandidateActions(payment);

  const candidates = interventions.map(
    (intervention) => ({
      intervention,
      rationale: intervention,
    }),
  );

  if (interventions.length === 0) {
    return {
      paymentId: payment.id,
      intervention:
        options.fallbackIntervention ??
        "STOP_PERMANENT",
      reasoning:
        "No permissible candidate actions were available. " +
        "Deterministic fallback selected a safe terminal action.",
      confidence: 1,
      source: "fallback",
      fallbackUsed: true,
      candidates,
    };
  }

  const request: AIDecisionRequest = {
    payment,
    candidates,
    policyContext: buildPolicyContext(payment),
  };

  try {
    const rawResponse =
      await options.provider.decide(request);

    const response =
      validateAIResponse(
        request,
        rawResponse,
      );

    return {
      paymentId: payment.id,
      intervention: response.intervention,
      reasoning: response.reasoning,
      confidence: response.confidence,
      source: "llm",
      fallbackUsed: false,
      candidates,
    };
  } catch (error) {
    const fallback =
      chooseSafeFallback(
        interventions,
        options.fallbackIntervention,
      );

    const errorMessage =
      error instanceof Error
        ? error.message
        : "Unknown AI provider error";

    return {
      paymentId: payment.id,
      intervention: fallback,
      reasoning:
        `AI decision was unavailable or invalid. ` +
        `Deterministic fallback selected ${fallback}. ` +
        `Provider error: ${errorMessage}`,
      confidence: 1,
      source: "fallback",
      fallbackUsed: true,
      candidates,
    };
  }
}

/**
 * Select a deterministic fallback.
 *
 * Safety beats recovery when the AI layer is unavailable.
 *
 * We therefore:
 * 1. honour an explicitly configured fallback if permitted;
 * 2. otherwise prefer a non-charge action;
 * 3. finally fall back to the first deterministic candidate.
 */
function chooseSafeFallback(
  candidates: readonly Intervention[],
  configuredFallback?: Intervention,
): Intervention {
  if (
    configuredFallback !== undefined &&
    candidates.includes(
      configuredFallback,
    )
  ) {
    return configuredFallback;
  }

  const safeNonChargeActions: readonly Intervention[] = [
    "RECONCILE_THEN_DECIDE",
    "REQUEST_INSTRUMENT_UPDATE",
    "REQUEST_REAUTHORIZATION",
    "ESCALATE_HUMAN",
    "STOP_PERMANENT",
  ];

  const safeFallback =
    safeNonChargeActions.find(
      (intervention) =>
        candidates.includes(intervention),
    );

  return (
    safeFallback ??
    candidates[0]!
  );
}