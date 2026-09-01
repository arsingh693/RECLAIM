import {
  AIProvider,
  AIDecisionRequest,
  AIDecisionResponse,
} from "./types";

/**
 * Provider factory contract.
 *
 * The rest of RECLAIM should depend only on AIProvider.
 * This keeps the model vendor replaceable.
 */
export type AIProviderFactory = () => AIProvider;

/**
 * Validate and normalize a provider response.
 *
 * This is intentionally strict. A model response is untrusted input,
 * even when it comes from a reputable model provider.
 */
export function validateAIResponse(
  request: AIDecisionRequest,
  response: AIDecisionResponse,
): AIDecisionResponse {
  const permitted = request.candidates.some(
    (candidate) =>
      candidate.intervention === response.intervention,
  );

  if (!permitted) {
    throw new Error(
      `AI selected an intervention outside the permitted candidate set: ${response.intervention}`,
    );
  }

  if (
    !Number.isFinite(response.confidence) ||
    response.confidence < 0 ||
    response.confidence > 1
  ) {
    throw new Error(
      "AI confidence must be a number between 0 and 1",
    );
  }

  if (
    typeof response.reasoning !== "string" ||
    response.reasoning.trim().length === 0
  ) {
    throw new Error(
      "AI reasoning must be a non-empty string",
    );
  }

  return {
    intervention: response.intervention,
    reasoning: response.reasoning.trim(),
    confidence: response.confidence,
  };
}