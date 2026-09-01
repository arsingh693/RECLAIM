import type {
  FailedPayment,
  Intervention,
} from "../domain/types";

/**
 * A candidate action exposed to the AI.
 *
 * The AI can select only from these deterministic candidates.
 */
export interface CandidateAction {
  readonly intervention: Intervention;
  readonly rationale: string;
}

/**
 * Request sent to an AI provider.
 */
export interface AIDecisionRequest {
  readonly payment: FailedPayment;
  readonly candidates: readonly CandidateAction[];
  readonly policyContext: string;
}

/**
 * Normalised response returned by an AI provider.
 *
 * `intervention` may be null when the provider cannot make a
 * safe/valid selection.
 */
export interface AIDecisionResponse {
  readonly intervention: Intervention | null;
  readonly reasoning: string;
  readonly confidence: number;
}

/**
 * Provider abstraction.
 */
export interface AIProvider {
  decide(
    request: AIDecisionRequest,
  ): Promise<AIDecisionResponse>;
}

/**
 * Configuration for the decision agent.
 */
export interface DecisionAgentOptions {
  readonly provider: AIProvider;
  readonly fallbackIntervention: Intervention;
}

/**
 * Result produced by the decision agent.
 */
export interface AgentDecisionResult {
  readonly paymentId: string;
  readonly intervention: Intervention | null;
  readonly reasoning: string;
  readonly confidence: number;
  readonly candidates: readonly CandidateAction[];
  readonly fallbackUsed: boolean;
  readonly source: "llm" | "fallback";
}

/**
 * Input consumed by the prompt builder.
 */
export interface AIRecoveryInput {
  readonly payment: FailedPayment;
  readonly permittedInterventions: readonly CandidateAction[];
  readonly policyContext: string;
}