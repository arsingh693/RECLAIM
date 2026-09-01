import {
  createSimulatedPaymentGateway,
} from "../src/gateway/simulatedGateway";

import type {
  AttemptOutcome,
  FailedPayment,
} from "../src/domain/types";

async function main(): Promise<void> {
  const payment: FailedPayment = {
    id: "pay_gateway_check",
    merchantId: "merchant_gateway_check",
    chargeKind: "one_time",
    amountPaise: 49900,
    currency: "INR",
    method: "card",
    declineCode: "ISSUER_UNAVAILABLE",
    gatewayRawReason:
      "issuer temporarily unavailable",
    failedAt:
      "2026-08-31T04:00:00.000Z",
    attemptsSoFar: 0,
    customer: {
      customerId: "customer_gateway_check",
      successfulChargesLifetime: 10,
      consecutiveFailures: 0,
      availableMethods: [
        "card",
        "upi",
      ],
      historicalPaydayHint: 1,
      contactOptOut: false,
      hasOpenDispute: false,
      timezone: "Asia/Kolkata",
    },
    mandateCeilingPaise: null,
  };

  /*
   * The simulator now receives the payment population when it is
   * created. This keeps registerPayment out of the public
   * PaymentGateway interface.
   */
  const gateway =
    createSimulatedPaymentGateway({
      seed: "gateway-check",
      payments: [payment],
    });

  const first: AttemptOutcome =
    await gateway.charge({
      paymentId: payment.id,
      amountPaise: payment.amountPaise,
      currency: payment.currency,
      method: payment.method,
      attemptNumber: 1,
      idempotencyKey:
        `${payment.id}:gateway-check:attempt:1`,
    });

  const second: AttemptOutcome =
    await gateway.charge({
      paymentId: payment.id,
      amountPaise: payment.amountPaise,
      currency: payment.currency,
      method: payment.method,
      attemptNumber: 2,
      idempotencyKey:
        `${payment.id}:gateway-check:attempt:2`,
    });

  if (
    first.paymentId !== payment.id ||
    second.paymentId !== payment.id
  ) {
    throw new Error(
      "Gateway returned an unexpected payment ID",
    );
  }

  if (
    first.attemptedAt ===
    second.attemptedAt
  ) {
    throw new Error(
      "Gateway attempts should have distinct timestamps",
    );
  }

  if (
    first.recoveredPaise < 0 ||
    second.recoveredPaise < 0
  ) {
    throw new Error(
      "Gateway returned negative recovery amount",
    );
  }

  /**
   * The simulator must expose a valid outcome:
   *
   * - success with recovered money, OR
   * - decline with a decline code, OR
   * - indeterminate result requiring reconciliation.
   *
   * It must never silently return an impossible state.
   */
  const validateOutcome = (
    outcome: AttemptOutcome,
  ): void => {
    if (outcome.indeterminate) {
      if (
        outcome.gatewayReference !== null
      ) {
        throw new Error(
          "Indeterminate gateway outcome must not claim a final gateway reference",
        );
      }

      return;
    }

    if (outcome.succeeded) {
      if (
        outcome.recoveredPaise <= 0
      ) {
        throw new Error(
          "Successful gateway outcome must recover positive money",
        );
      }

      if (
        outcome.declineCode !== null
      ) {
        throw new Error(
          "Successful outcome must not contain a decline code",
        );
      }

      return;
    }

    if (
      outcome.declineCode === null
    ) {
      throw new Error(
        "Failed deterministic gateway outcome must contain a decline code",
      );
    }

    if (
      outcome.recoveredPaise !== 0
    ) {
      throw new Error(
        "Failed gateway outcome cannot recover money",
      );
    }
  };

  validateOutcome(first);
  validateOutcome(second);

  console.log(
    "✓ simulated gateway invariants hold",
  );
}

main().catch((error: unknown) => {
  console.error(
    "✗ gateway check failed",
  );
  console.error(error);

  process.exitCode = 1;
});