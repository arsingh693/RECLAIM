import { GoogleGenAI } from "@google/genai";

import {
  AIDecisionRequest,
  AIDecisionResponse,
  AIProvider,
} from "./types";

import { Intervention } from "../domain/types";

/**
 * Gemini-backed implementation of our AIProvider abstraction.
 *
 * IMPORTANT ARCHITECTURAL RULE:
 *
 * Gemini recommends an action.
 * Gemini never executes a payment.
 * Gemini never changes policy constraints.
 * Gemini never changes guardrails.
 *
 * The deterministic layers remain authoritative.
 */

const DEFAULT_MODEL =
  process.env.GEMINI_MODEL ??
  "gemini-3.7-flash";

const DEFAULT_TIMEOUT_MS = 15_000;

const INTERVENTIONS: readonly Intervention[] = [
  "RETRY_NOW",
  "RETRY_SCHEDULED",
  "RETRY_ALTERNATE_RAIL",
  "RETRY_SPLIT_AMOUNT",
  "RECONCILE_THEN_DECIDE",
  "REQUEST_INSTRUMENT_UPDATE",
  "REQUEST_REAUTHORIZATION",
  "NUDGE_THEN_RETRY",
  "ESCALATE_HUMAN",
  "STOP_PERMANENT",
];

/**
 * The model's output schema is intentionally tiny.
 *
 * Do not expose the full domain object to the model as output.
 * The model only needs to recommend an intervention and explain it.
 */
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    intervention: {
      type: "string",
      enum: INTERVENTIONS,
      description:
        "Exactly one intervention from the permitted candidate set.",
    },
    reasoning: {
      type: "string",
      description:
        "Concise explanation grounded only in the supplied payment context and policy constraints.",
    },
    confidence: {
      type: "number",
      description:
        "Confidence from 0.0 to 1.0 in the selected intervention.",
    },
  },
  required: [
    "intervention",
    "reasoning",
    "confidence",
  ],
};

/**
 * Gemini provider configuration.
 */
export interface GeminiProviderOptions {
  readonly apiKey?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
}

/**
 * Provider implementation.
 */
export class GeminiAIProvider
  implements AIProvider
{
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(
    options: GeminiProviderOptions = {},
  ) {
    const apiKey =
      options.apiKey ??
      process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error(
        "GEMINI_API_KEY is not configured",
      );
    }

    this.apiKey = apiKey;

    this.model =
      options.model ??
      DEFAULT_MODEL;

    this.timeoutMs =
      options.timeoutMs ??
      DEFAULT_TIMEOUT_MS;
  }

  async decide(
    request: AIDecisionRequest,
  ): Promise<AIDecisionResponse> {
    if (request.candidates.length === 0) {
      throw new Error(
        "Gemini cannot decide without permitted candidates",
      );
    }

    const permitted =
      request.candidates.map(
        (candidate) =>
          candidate.intervention,
      );

    const prompt =
      buildDecisionPrompt(
        request,
        permitted,
      );

    const ai = new GoogleGenAI({
      apiKey: this.apiKey,
    });

    const generation =
      ai.models.generateContent({
        model: this.model,
        contents: prompt,
        config: {
          responseMimeType:
            "application/json",
          responseJsonSchema:
            RESPONSE_SCHEMA,
        },
      });

    const response =
      await withTimeout(
        generation,
        this.timeoutMs,
        "Gemini decision request timed out",
      );

    const text =
      response.text?.trim();

    if (!text) {
      throw new Error(
        "Gemini returned an empty response",
      );
    }

    const parsed =
      parseGeminiResponse(text);

    /**
     * Structured output constrains the shape,
     * but this explicit application-level validation
     * is still mandatory.
     */
    validateGeminiResponse(
      parsed,
      permitted,
    );

    return parsed;
  }
}

/**
 * Build a deliberately restrictive prompt.
 *
 * The candidate list is repeated explicitly so that the model understands
 * it is choosing from a closed set rather than designing its own policy.
 */
function buildDecisionPrompt(
  request: AIDecisionRequest,
  permitted: readonly Intervention[],
): string {
  const candidateDescriptions =
    request.candidates
      .map(
        (candidate) =>
          `- ${candidate.intervention}: ${candidate.rationale}`,
      )
      .join("\n");

  return [
    "You are the decision component of RECLAIM, a payment recovery orchestrator.",
    "",
    "Your role is advisory only.",
    "You must select exactly one intervention from the permitted candidate set.",
    "You must not invent interventions.",
    "You must not increase attempt limits.",
    "You must not authorize an action outside the candidate set.",
    "You must not execute or simulate a payment.",
    "",
    "DETERMINISTIC POLICY CONTEXT:",
    request.policyContext,
    "",
    "PERMITTED CANDIDATES:",
    candidateDescriptions,
    "",
    `CLOSED ACTION SET: ${permitted.join(", ")}`,
    "",
    "DECISION RULES:",
    "1. Prefer recovery when the supplied context supports it.",
    "2. Respect attempt limits and all hard constraints.",
    "3. Treat contact opt-out and open disputes as hard stops.",
    "4. Never infer permission that the policy context does not provide.",
    "5. If the situation is ambiguous or unsafe, prefer the safer permitted action.",
    "6. Reason only from the supplied payment and policy context.",
    "",
    "Return only the requested structured JSON response.",
  ].join("\n");
}

/**
 * Parse Gemini's structured response.
 *
 * JSON parsing is kept separate from semantic validation so failures
 * are easy to diagnose and audit.
 */
function parseGeminiResponse(
  text: string,
): AIDecisionResponse {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      "Gemini returned invalid JSON",
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null
  ) {
    throw new Error(
      "Gemini response must be a JSON object",
    );
  }

  const value =
    parsed as Record<
      string,
      unknown
    >;

  if (
    typeof value.intervention !==
    "string"
  ) {
    throw new Error(
      "Gemini response is missing a valid intervention",
    );
  }

  if (
    typeof value.reasoning !==
    "string"
  ) {
    throw new Error(
      "Gemini response is missing valid reasoning",
    );
  }

  if (
    typeof value.confidence !==
    "number"
  ) {
    throw new Error(
      "Gemini response is missing valid confidence",
    );
  }

  return {
    intervention:
      value.intervention as Intervention,
    reasoning:
      value.reasoning,
    confidence:
      value.confidence,
  };
}

/**
 * Final provider-level validation.
 *
 * This is intentionally separate from the general validateAIResponse()
 * function because the provider itself should reject malformed or
 * unauthorized model output before returning it to the agent.
 */
function validateGeminiResponse(
  response: AIDecisionResponse,
  permitted: readonly Intervention[],
): void {
  /**
   * A null intervention is never executable.
   *
   * Reject it at the provider boundary rather than allowing null to flow
   * into candidate validation or downstream execution.
   */
  if (response.intervention === null) {
    throw new Error(
      "Gemini did not select an intervention",
    );
  }

  if (
    !permitted.includes(
      response.intervention,
    )
  ) {
    throw new Error(
      `Gemini selected an intervention outside the permitted candidate set: ${response.intervention}`,
    );
  }

  if (
    !INTERVENTIONS.includes(
      response.intervention,
    )
  ) {
    throw new Error(
      `Gemini returned an unknown intervention: ${response.intervention}`,
    );
  }

  if (
    !Number.isFinite(
      response.confidence,
    ) ||
    response.confidence < 0 ||
    response.confidence > 1
  ) {
    throw new Error(
      "Gemini confidence must be between 0 and 1",
    );
  }
}

/**
 * Prevent a slow/unavailable model from blocking the entire recovery batch.
 *
 * The caller's deterministic fallback remains responsible for deciding
 * what happens after this timeout.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer:
    | ReturnType<typeof setTimeout>
    | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>(
        (_, reject) => {
          timer = setTimeout(
            () => {
              reject(
                new Error(message),
              );
            },
            timeoutMs,
          );
        },
      ),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}  