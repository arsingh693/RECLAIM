import type {
  AIDecisionRequest,
  AIDecisionResponse,
  AIProvider,
} from "./types";

export class StubAIProvider implements AIProvider {
  async decide(
    request: AIDecisionRequest,
  ): Promise<AIDecisionResponse> {
    const candidates = request.candidates;

    if (candidates.length === 0) {
      throw new Error(
        "No policy-approved candidate actions available.",
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
        ): candidate is (typeof candidates)[number] =>
          candidate !== undefined,
      );

    if (!selected) {
      throw new Error(
        "Unable to select a policy-approved intervention.",
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
      confidence: 0.75
    };
  }
}