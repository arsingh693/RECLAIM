import type {
  AttemptOutcome,
  DeclineCode,
  FailedPayment,
  PaymentMethod,
} from "../domain/types";
import type {
  ChargeRequest,
  PaymentGateway,
  ReconciliationResult,
  RecoveryLinkRequest,
  RecoveryLinkResult,
} from "./types";

interface SimulatedPaymentState {
  readonly payment: FailedPayment;
  status: "pending" | "captured" | "failed";
  lastDeclineCode: DeclineCode | null;
  attempts: number;
  outcomes: Map<string, AttemptOutcome>;
}

/** Small deterministic hash; stable across machines and Node versions. */
function hash32(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function unit(seed: string): number {
  return hash32(seed) / 4294967296;
}

function gatewayReference(seed: string): string {
  return `sim_${hash32(seed).toString(36)}`;
}

/**
 * Deterministic in-memory gateway for experiments.
 *
 * There is deliberately no Math.random() here. Given the same seed and the
 * same sequence of requests, the same payment produces the same outcomes.
 * This is what makes the baseline-vs-agent comparison reproducible.
 */
export class SimulatedGateway implements PaymentGateway {
  readonly name = "simulated" as const;

  private readonly payments = new Map<string, SimulatedPaymentState>();

  constructor(
    private readonly seed: string,
    payments: readonly FailedPayment[],
  ) {
    for (const payment of payments) {
      if (this.payments.has(payment.id)) {
        throw new Error(`Duplicate payment id in simulator: ${payment.id}`);
      }

      this.payments.set(payment.id, {
        payment,
        status: "pending",
        lastDeclineCode: payment.declineCode,
        attempts: payment.attemptsSoFar,
        outcomes: new Map(),
      });
    }
  }

  async charge(request: ChargeRequest): Promise<AttemptOutcome> {
    const state = this.payments.get(request.paymentId);
    if (!state) {
      throw new Error(`Simulator does not know payment ${request.paymentId}`);
    }

    if (request.currency !== "INR") {
      throw new Error("Simulator only supports INR");
    }

    if (!Number.isSafeInteger(request.amountPaise) || request.amountPaise <= 0) {
      throw new Error("Charge amount must be a positive integer number of paise");
    }

    if (state.status === "captured") {
      throw new Error(
        `Payment ${request.paymentId} is already captured; a second charge is not permitted`,
      );
    }

    const key = `${request.idempotencyKey}|${request.amountPaise}|${request.method}`;
    const existing = state.outcomes.get(key);
    if (existing) {
      return existing;
    }

    state.attempts += 1;

    const outcome = this.resolveOutcome(state.payment, request, state.attempts);
    state.outcomes.set(key, outcome);

    if (outcome.succeeded) {
      state.status = "captured";
      state.lastDeclineCode = null;
    } else {
      state.status = "failed";
      state.lastDeclineCode = outcome.declineCode;
    }

    return outcome;
  }

  async reconcile({ paymentId }: { paymentId: string }): Promise<ReconciliationResult> {
    const state = this.payments.get(paymentId);
    if (!state) {
      throw new Error(`Simulator does not know payment ${paymentId}`);
    }

    const now = new Date().toISOString();
    if (state.status === "captured") {
      return {
        paymentId,
        status: "captured",
        outcome: {
          paymentId,
          succeeded: true,
          recoveredPaise: state.payment.amountPaise,
          declineCode: null,
          gatewayReference: gatewayReference(`${this.seed}:${paymentId}:captured`),
          attemptedAt: now,
          indeterminate: false,
        },
        gatewayReference: gatewayReference(`${this.seed}:${paymentId}:captured`),
        checkedAt: now,
      };
    }

    return {
      paymentId,
      status: state.status,
      outcome: null,
      gatewayReference: null,
      checkedAt: now,
    };
  }

  async createRecoveryLink(
    request: RecoveryLinkRequest,
  ): Promise<RecoveryLinkResult> {
    if (request.amountPaise <= 0 || !Number.isSafeInteger(request.amountPaise)) {
      throw new Error("Recovery-link amount must be a positive integer number of paise");
    }

    const ref = gatewayReference(
      `${this.seed}:${request.payment.id}:${request.referenceId}:${request.amountPaise}`,
    );

    return {
      paymentId: request.payment.id,
      supported: true,
      url: `https://simulated-gateway.local/recover/${ref}`,
      gatewayReference: ref,
      reason: null,
    };
  }

  private resolveOutcome(
    payment: FailedPayment,
    request: ChargeRequest,
    absoluteAttempt: number,
  ): AttemptOutcome {
    const now = new Date().toISOString();
    const base = `${this.seed}:${payment.id}:${absoluteAttempt}:${request.method}:${request.amountPaise}`;
    const roll = unit(base);

    const successProbability = this.successProbability(payment, request);
    const succeeds = roll < successProbability;

    if (succeeds) {
      return {
        paymentId: payment.id,
        succeeded: true,
        recoveredPaise: request.amountPaise,
        declineCode: null,
        gatewayReference: gatewayReference(base),
        attemptedAt: now,
        indeterminate: false,
      };
    }

    return {
      paymentId: payment.id,
      succeeded: false,
      recoveredPaise: 0,
      declineCode: payment.declineCode,
      gatewayReference: gatewayReference(base),
      attemptedAt: now,
      indeterminate: false,
    };
  }

  private successProbability(
    payment: FailedPayment,
    request: ChargeRequest,
  ): number {
    const { declineCode } = payment;

    switch (declineCode) {
      case "ISSUER_UNAVAILABLE":
        return request.attemptNumber >= 2 ? 0.82 : 0.55;
      case "INSUFFICIENT_FUNDS": {
        const payday = payment.customer.historicalPaydayHint;
        const amountFactor = Math.min(0.15, request.amountPaise / 100_000_000);
        const historyFactor = Math.min(0.12, payment.customer.successfulChargesLifetime / 500);
        const timingFactor = payday !== null ? 0.08 : 0;
        return Math.min(0.72, 0.26 + historyFactor + timingFactor - amountFactor);
      }
      case "LIMIT_EXCEEDED":
        return request.amountPaise < payment.amountPaise ? 0.68 : 0.18;
      case "DO_NOT_HONOUR":
        return request.method !== payment.method ? 0.46 : 0.16;
      case "CARD_EXPIRED":
      case "CARD_BLOCKED":
      case "AUTHENTICATION_FAILED":
      case "INVALID_INSTRUMENT":
        return request.method !== payment.method ? 0.64 : 0.01;
      case "MANDATE_PAUSED":
        return 0.01;
      case "MANDATE_LIMIT_EXCEEDED":
        return request.amountPaise < payment.amountPaise ? 0.61 : 0.04;
      case "RISK_BLOCKED":
        return 0;
      case "GATEWAY_TIMEOUT":
        // The simulator intentionally does not charge a timeout state. The
        // caller must reconcile, after which the payment should be represented
        // by a concrete result in the real workflow.
        return 0;
      default:
        return 0.25;
    }
  }
}

export function simulatorSupportsMethod(method: PaymentMethod): boolean {
  return ["card", "upi", "netbanking", "wallet", "emandate"].includes(method);
}
