import { AttemptOutcome, Decision, FailedPayment } from "../domain/types";

import { PaymentGateway, ChargeRequest } from "../gateway/types";

import { evaluateGuardrails } from "../policy/guardrails";

export interface ExecutionResult {
  readonly payment: FailedPayment;
  readonly decision: Decision;
  readonly guardrail: ReturnType<typeof evaluateGuardrails>;
  readonly outcome: AttemptOutcome | null;
  readonly executed: boolean;
}

export interface ExecutorOptions {
  readonly gateway: PaymentGateway;
  readonly now?: () => Date;
}

/**
 * Executes exactly one policy decision.
 *
 * Important architectural boundary:
 *
 *     policy → guardrails → gateway
 *
 * The decision policy never gets direct authority over money movement.
 * Every charge-producing intervention must pass through guardrails first.
 *
 * If a guardrail blocks the decision, the gateway is never called.
 */
export async function executeDecision(
  payment: FailedPayment,
  decision: Decision,
  options: ExecutorOptions,
): Promise<ExecutionResult> {
  const guardrail = evaluateGuardrails(payment, decision);

  if (!guardrail.allowed) {
    return {
      payment,
      decision,
      guardrail,
      outcome: null,
      executed: false,
    };
  }

  if (!consumesGatewayAttempt(decision)) {
    return {
      payment,
      decision,
      guardrail,
      outcome: null,
      executed: false,
    };
  }

  const request = buildChargeRequest(payment, decision);

  const outcome = await options.gateway.charge(request);

  return {
    payment,
    decision,
    guardrail,
    outcome,
    executed: true,
  };
}

/**
 * Only these interventions actually move money through the gateway.
 *
 * Reconciliation is intentionally excluded. A reconciliation operation
 * resolves an unknown state; it must never be treated as a fresh charge.
 */
function consumesGatewayAttempt(decision: Decision): boolean {
  switch (decision.intervention) {
    case "RETRY_NOW":
    case "RETRY_SCHEDULED":
    case "RETRY_ALTERNATE_RAIL":
    case "RETRY_SPLIT_AMOUNT":
    case "NUDGE_THEN_RETRY":
      return true;

    case "RECONCILE_THEN_DECIDE":
    case "REQUEST_INSTRUMENT_UPDATE":
    case "REQUEST_REAUTHORIZATION":
    case "ESCALATE_HUMAN":
    case "STOP_PERMANENT":
      return false;

    default:
      return false;
  }
}

/**
 * Convert our domain-level decision into the narrow gateway request.
 *
 * The gateway receives only the information necessary to execute the
 * permitted operation. Policy metadata and model reasoning do not leak
 * into the payment adapter.
 */
function buildChargeRequest(
  payment: FailedPayment,
  decision: Decision,
): ChargeRequest {
  let amountPaise = payment.amountPaise;

  if (
    decision.intervention ===
      "RETRY_SPLIT_AMOUNT" &&
    decision.splitAmountPaise !== null
  ) {
    amountPaise =
      decision.splitAmountPaise;
  }

  const method =
    decision.intervention ===
      "RETRY_ALTERNATE_RAIL" &&
    decision.switchToMethod !== null
      ? decision.switchToMethod
      : payment.method;

  const attemptNumber =
    payment.attemptsSoFar + 1;

  /*
   * Idempotency is deterministic for the logical payment attempt.
   *
   * The same attempt can therefore be safely replayed after a process
   * crash or network interruption without creating a second charge.
   */
  const idempotencyKey =
    `${payment.id}:attempt:${attemptNumber}`;

  return {
    paymentId: payment.id,
    amountPaise,
    currency: payment.currency,
    method,
    attemptNumber,
    idempotencyKey,
  };
}

/**
 * Small helper used by tests and orchestration code to determine whether
 * a decision represents an actual charge attempt.
 */
export function isChargeDecision(decision: Decision): boolean {
  return consumesGatewayAttempt(decision);
}
