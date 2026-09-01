import {
  AIDecisionRequest,
  AIDecisionResponse,
  AIProvider,
} from "./types";

/**
 * Deterministic provider used during development and evaluation.
 *
 * It deliberately behaves like a conservative decision model:
 * it chooses only from the candidate actions supplied by the policy.
 *
 * This gives us:
 * - reproducible runs
 * - no API key requirement
 * - deterministic benchmark results
 * - a reliable fallback when the real model is unavailable
 *
 * The production Gemini provider will implement the exact same
 * AIProvider interface.
 */
export class StubAIProvider implements AIProvider {
  async decide(
    request: AIDecisionRequest,
  ): Promise<AIDecisionResponse> {
    const candidates = request.candidates;

    if (candidates.length === 0) {
      throw new Error(
        "Stub AI cannot decide without permitted candidates",
      );
    }

    const preferredOrder = [
      "RETRY_NOW",
      "RETRY_SCHEDULED",
      "RETRY_ALTERNATE_RAIL",
      "RETRY_SPLIT_AMOUNT",
      "NUDGE_THEN_RETRY",
      "REQUEST_INSTRUMENT_UPDATE",
      "REQUEST_REAUTHORIZATION",
      "RECONCILE_THEN_DECIDE",
      "ESCALATE_HUMAN",
      "STOP_PERMANENT",
    ] as const;

    /**
     * Prefer actions according to the deterministic priority above,
     * but never select something outside the policy candidate set.
     */
    const selected = preferredOrder
      .map((intervention) =>
        candidates.find(
          (candidate) =>
            candidate.intervention === intervention,
        ),
      )
      .find(
        (
          candidate,
        ): candidate is AIDecisionRequest["candidates"][number] =>
          candidate !== undefined,
      );

    if (!selected) {
      throw new Error(
        "Stub AI could not select a permitted intervention",
      );
    }

    return {
      intervention: selected.intervention,
      reasoning: [
        "Deterministic development provider selected",
        selected.intervention,
        "from the policy-approved candidate set.",
        `Payment failure: ${request.payment.declineCode}.`,
        `Available candidates: ${candidates
          .map((candidate) => candidate.intervention)
          .join(", ")}.`,
      ].join(" "),
      confidence: 0.75,
    };
  }
}