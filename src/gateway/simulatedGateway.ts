/**
 * Deterministic payment gateway simulator.
 *
 * The simulator exists so that the benchmark can compare the
 * baseline and RECLAIM against the same payment population.
 *
 * Gateway OUTCOMES are deterministic.
 * Individual ATTEMPTS receive distinct timestamps.
 */

import type {
  AttemptOutcome,
  DeclineCode,
  FailedPayment,
  PaymentMethod,
} from "../domain/types";

import type {
  ChargeRequest,
  PaymentGateway,
  ReconcileRequest,
  ReconciliationResult,
  RecoveryLinkRequest,
  RecoveryLinkResult,
} from "./types";

export interface SimulatedGatewayOptions {
  readonly seed: string;
  readonly baseDate?: string;
  readonly payments?: readonly FailedPayment[];
}

type SimulatedOutcome =
  | {
      readonly kind: "success";
    }
  | {
      readonly kind: "decline";
      readonly declineCode: DeclineCode;
    }
  | {
      readonly kind: "timeout";
    };

interface PendingReconciliation {
  readonly outcome: "success" | "decline";
  readonly declineCode: DeclineCode | null;
  readonly recoveredPaise: number;
}

function hash32(
  input: string,
): number {
  let hash = 2166136261;

  for (
    let index = 0;
    index < input.length;
    index += 1
  ) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(
      hash,
      16777619,
    );
  }

  return hash >>> 0;
}

function unit(
  input: string,
): number {
  return (
    hash32(input) /
    4294967296
  );
}

function attemptTimestamp(
  baseDate: string,
  sequence: number,
): string {
  const base =
    Date.parse(baseDate);

  if (!Number.isFinite(base)) {
    throw new Error(
      `Invalid simulator base date: ${baseDate}`,
    );
  }

  /**
   * Each simulator call advances the deterministic
   * simulator clock by one second.
   *
   * This is NOT wall-clock time.
   * It exists purely to make the audit trail ordered
   * and reproducible.
   */
  return new Date(
    base +
      sequence * 1000,
  ).toISOString();
}

function determineOutcome(
  seed: string,
  payment: FailedPayment,
  method: PaymentMethod,
  amountPaise: number,
): SimulatedOutcome {
  const key = [
    seed,
    payment.id,
    payment.declineCode,
    payment.attemptsSoFar,
    method,
    amountPaise,
  ].join(":");

  switch (
    payment.declineCode
  ) {
    case "CARD_EXPIRED":
      return {
        kind: "decline",
        declineCode:
          "CARD_EXPIRED",
      };

    case "CARD_BLOCKED":
      return {
        kind: "decline",
        declineCode:
          "CARD_BLOCKED",
      };

    case "RISK_BLOCKED":
      return {
        kind: "decline",
        declineCode:
          "RISK_BLOCKED",
      };

    case "INVALID_INSTRUMENT":
      return {
        kind: "decline",
        declineCode:
          "INVALID_INSTRUMENT",
      };

    case "MANDATE_PAUSED":
      if (
        method !== payment.method
      ) {
        return {
          kind: "success",
        };
      }

      return {
        kind: "decline",
        declineCode:
          "MANDATE_PAUSED",
      };

    case "AUTHENTICATION_FAILED":
      if (
        method !== payment.method
      ) {
        return {
          kind: "success",
        };
      }

      break;

    case "ISSUER_UNAVAILABLE":
      if (
        unit(`${key}:temporary`) <
        0.72
      ) {
        return {
          kind: "success",
        };
      }

      break;

    case "INSUFFICIENT_FUNDS":
      if (
        method !== payment.method &&
        unit(`${key}:alternate`) <
          0.78
      ) {
        return {
          kind: "success",
        };
      }

      if (
        unit(`${key}:funds`) <
        0.32
      ) {
        return {
          kind: "success",
        };
      }

      break;

    case "LIMIT_EXCEEDED":
      if (
        amountPaise <
        payment.amountPaise
      ) {
        return {
          kind: "success",
        };
      }

      if (
        method !== payment.method &&
        unit(`${key}:limit-alt`) <
          0.55
      ) {
        return {
          kind: "success",
        };
      }

      break;

    case "MANDATE_LIMIT_EXCEEDED":
      if (
        payment.mandateCeilingPaise !==
          null &&
        amountPaise <=
          payment.mandateCeilingPaise
      ) {
        return {
          kind: "success",
        };
      }

      break;

    case "DO_NOT_HONOUR":
      if (
        method !== payment.method &&
        unit(`${key}:dnh-alt`) <
          0.58
      ) {
        return {
          kind: "success",
        };
      }

      if (
        unit(`${key}:dnh-retry`) <
        0.18
      ) {
        return {
          kind: "success",
        };
      }

      break;

    case "GATEWAY_TIMEOUT":
      return {
        kind: "timeout",
      };
  }

  return {
    kind: "decline",
    declineCode:
      payment.declineCode,
  };
}

export interface SimulatedPaymentGateway
  extends PaymentGateway {
  registerPayment(
    payment: FailedPayment,
  ): void;
}

export function createSimulatedPaymentGateway(
  options: SimulatedGatewayOptions,
): SimulatedPaymentGateway {
  const baseDate =
    options.baseDate ??
    "2026-08-31T04:30:00.000Z";

  /**
   * Deterministic sequence counter.
   *
   * Every charge call gets a unique sequence number.
   */
  let sequence = 0;

  /**
   * The new PaymentGateway interface receives only a ChargeRequest.
   * Therefore the simulator needs to remember the FailedPayment
   * associated with each payment ID.
   */
  const payments =
  new Map<string, FailedPayment>(
    (options.payments ?? []).map(
      (payment) => [payment.id, payment],
    ),
  );

  const pendingReconciliation =
    new Map<
      string,
      PendingReconciliation
    >();

  /**
   * Register a payment with the simulator.
   *
   * The payment itself is not part of ChargeRequest because the
   * production gateway boundary should not require the full domain
   * object for every gateway call.
   */
  const registerPayment = (
    payment: FailedPayment,
  ): void => {
    payments.set(
      payment.id,
      payment,
    );
  };

  return {
    name: "simulated",

    async charge(
      request: ChargeRequest,
    ): Promise<AttemptOutcome> {
      sequence += 1;

      const payment =
        payments.get(
          request.paymentId,
        );

      if (!payment) {
        throw new Error(
          `Payment ${request.paymentId} has not been registered with the simulated gateway`,
        );
      }

      if (
        !Number.isSafeInteger(
          request.amountPaise,
        ) ||
        request.amountPaise <= 0
      ) {
        throw new Error(
          "Gateway charge amount must be a positive integer number of paise",
        );
      }

      if (
        !payment.customer.availableMethods.includes(
          request.method,
        )
      ) {
        throw new Error(
          `Payment method ${request.method} is not available for ${payment.id}`,
        );
      }

      /**
       * Mandate ceiling is a gateway-level constraint too.
       */
      if (
        payment.chargeKind ===
          "subscription_renewal" &&
        payment.mandateCeilingPaise !==
          null &&
        request.amountPaise >
          payment.mandateCeilingPaise
      ) {
        return {
          paymentId: payment.id,
          succeeded: false,
          recoveredPaise: 0,
          declineCode:
            "MANDATE_LIMIT_EXCEEDED",
          gatewayReference: null,
          attemptedAt:
            attemptTimestamp(
              baseDate,
              sequence,
            ),
          indeterminate: false,
        };
      }

      const outcome =
        determineOutcome(
          options.seed,
          payment,
          request.method,
          request.amountPaise,
        );

      const attemptedAt =
        attemptTimestamp(
          baseDate,
          sequence,
        );

      /**
       * Gateway timeout.
       *
       * This is deliberately NOT treated as a decline.
       * The final state is unknown until reconciliation.
       */
      if (
        outcome.kind ===
        "timeout"
      ) {
        const reconciliationKey =
          `${payment.id}:${sequence}`;

        const resolvesToSuccess =
          unit(
            [
              options.seed,
              payment.id,
              payment.attemptsSoFar,
              request.method,
              request.amountPaise,
              "reconcile",
            ].join(":"),
          ) < 0.45;

        pendingReconciliation.set(
          reconciliationKey,
          {
            outcome:
              resolvesToSuccess
                ? "success"
                : "decline",

            declineCode:
              resolvesToSuccess
                ? null
                : payment.declineCode,

            recoveredPaise:
              resolvesToSuccess
                ? request.amountPaise
                : 0,
          },
        );

        return {
          paymentId: payment.id,
          succeeded: false,
          recoveredPaise: 0,
          declineCode: null,
          gatewayReference: null,
          attemptedAt,
          indeterminate: true,
        };
      }

      /**
       * Successful charge.
       */
      if (
        outcome.kind ===
        "success"
      ) {
        return {
          paymentId: payment.id,
          succeeded: true,
          recoveredPaise:
            request.amountPaise,
          declineCode: null,
          gatewayReference:
            `sim_ch_${hash32(
              [
                options.seed,
                payment.id,
                sequence,
              ].join(":"),
            ).toString(16)}`,
          attemptedAt,
          indeterminate: false,
        };
      }

      /**
       * Deterministic decline.
       */
      return {
        paymentId: payment.id,
        succeeded: false,
        recoveredPaise: 0,
        declineCode:
          outcome.declineCode,
        gatewayReference: null,
        attemptedAt,
        indeterminate: false,
      };
    },

    async reconcile(
      request: ReconcileRequest,
    ): Promise<ReconciliationResult> {
      const payment =
        payments.get(
          request.paymentId,
        );

      if (!payment) {
        throw new Error(
          `Payment ${request.paymentId} has not been registered with the simulated gateway`,
        );
      }

      const checkedAt =
        attemptTimestamp(
          baseDate,
          ++sequence,
        );

      const matching =
        Array.from(
          pendingReconciliation.entries(),
        ).filter(
          ([key]) =>
            key.startsWith(
              `${payment.id}:`,
            ),
        );

      if (
        matching.length === 0
      ) {
        return {
          paymentId: payment.id,
          status: "unknown",
          outcome: null,
          gatewayReference: null,
          checkedAt,
        };
      }

      const [
        reconciliationKey,
        resolved,
      ] =
        matching[
          matching.length - 1
        ]!;

      pendingReconciliation.delete(
        reconciliationKey,
      );

      if (
        resolved.outcome ===
        "success"
      ) {
        const outcome: AttemptOutcome =
          {
            paymentId: payment.id,
            succeeded: true,
            recoveredPaise:
              resolved.recoveredPaise,
            declineCode: null,
            gatewayReference:
              `sim_rec_${hash32(
                `${options.seed}:${reconciliationKey}`,
              ).toString(16)}`,
            attemptedAt:
              checkedAt,
            indeterminate: false,
          };

        return {
          paymentId: payment.id,
          status: "captured",
          outcome,
          gatewayReference:
            outcome.gatewayReference,
          checkedAt,
        };
      }

      const outcome: AttemptOutcome =
        {
          paymentId: payment.id,
          succeeded: false,
          recoveredPaise: 0,
          declineCode:
            resolved.declineCode,
          gatewayReference: null,
          attemptedAt:
            checkedAt,
          indeterminate: false,
        };

      return {
        paymentId: payment.id,
        status: "failed",
        outcome,
        gatewayReference: null,
        checkedAt,
      };
    },

    async createRecoveryLink(
      request: RecoveryLinkRequest,
    ): Promise<RecoveryLinkResult> {
      registerPayment(
        request.payment,
      );

      if (
        !Number.isSafeInteger(
          request.amountPaise,
        ) ||
        request.amountPaise <= 0
      ) {
        return {
          paymentId:
            request.payment.id,
          supported: false,
          url: null,
          gatewayReference: null,
          reason:
            "Recovery-link amount must be a positive integer number of paise",
        };
      }

      const reference =
        `sim_link_${hash32(
          [
            options.seed,
            request.payment.id,
            request.referenceId,
            request.amountPaise,
          ].join(":"),
        ).toString(16)}`;

      return {
        paymentId:
          request.payment.id,
        supported: true,
        url: `https://simulated.gateway/recovery/${reference}`,
        gatewayReference:
          reference,
        reason: null,
      };
    },
    registerPayment,
  };
}