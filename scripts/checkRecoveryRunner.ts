import { generateSeedBatch } from "../src/data/seedBatch";

import {
  createSimulatedPaymentGateway,
} from "../src/gateway/simulatedGateway";

import { StubAIProvider } from "../src/ai/stubProvider";

import {
  runRecovery,
} from "../src/orchestration/recoveryRunner";

async function main(): Promise<void> {
  const batch = generateSeedBatch({
    seed: "recovery-runner-check",
    size: 12,
  });

  const aiProvider =
    new StubAIProvider();

  let recovered = 0;
  let stopped = 0;
  let escalated = 0;
  let reconciled = 0;

  for (const payment of batch.payments) {
    const gateway =
      createSimulatedPaymentGateway({
        seed: "recovery-runner-check",
      });

    /**
     * The simulator requires payments to be registered before a charge.
     *
     * createRecoveryLink is the gateway's public registration-compatible
     * operation, so use it here without actually relying on the generated
     * link for the experiment.
     */
    await gateway.createRecoveryLink({
      payment,
      amountPaise: payment.amountPaise,
      description: "Recovery runner invariant check",
      referenceId: `check:${payment.id}`,
    });

    const result =
      await runRecovery(
        payment,
        {
          gateway,
          aiProvider,
          maxTransitions: 8,
        },
      );

    if (
      result.stopReason ===
      "RECOVERED"
    ) {
      recovered += 1;
    }

    if (
      result.stopReason ===
        "PERMANENT_STOP" ||
      result.stopReason ===
        "NO_ACTION"
    ) {
      stopped += 1;
    }

    if (
      result.stopReason ===
      "HUMAN_ESCALATION"
    ) {
      escalated += 1;
    }

    if (
      result.stopReason ===
        "RECONCILIATION_FAILED" ||
      result.stopReason ===
        "RECONCILIATION_STILL_UNKNOWN"
    ) {
      reconciled += 1;
    }

    /**
     * Defensive invariant:
     *
     * The recovery runner must never exceed its configured transition
     * ceiling.
     */
    if (
      result.decisionsMade >
      8
    ) {
      throw new Error(
        `Recovery exceeded transition ceiling for ${payment.id}`,
      );
    }

    /**
     * Every recorded outcome must belong to the same payment.
     */
    for (const outcome of result.outcomes) {
      if (
        outcome.paymentId !==
        payment.id
      ) {
        throw new Error(
          `Recovery returned an outcome for the wrong payment: ${payment.id}`,
        );
      }

      if (
        outcome.recoveredPaise <
        0
      ) {
        throw new Error(
          `Recovery returned negative recovery for ${payment.id}`,
        );
      }
    }

    /**
     * A successful recovery must contain at least one successful outcome.
     */
    if (
      result.stopReason ===
      "RECOVERED"
    ) {
      const hasSuccessfulOutcome =
        result.outcomes.some(
          (outcome) =>
            outcome.succeeded,
        );

      if (
        !hasSuccessfulOutcome
      ) {
        throw new Error(
          `Payment ${payment.id} was marked recovered without a successful outcome`,
        );
      }
    }

    /**
     * Human escalation must actually be represented by the counter.
     */
    if (
      result.stopReason ===
        "HUMAN_ESCALATION" &&
      result.humanEscalations < 1
    ) {
      throw new Error(
        `Payment ${payment.id} escalated without recording a human escalation`,
      );
    }

    /**
     * Every run must produce a valid audit trail.
     */
    if (
      result.auditTrail.length ===
      0
    ) {
      throw new Error(
        `Recovery produced no audit trail for ${payment.id}`,
      );
    }
  }

  console.log(
    "✓ recovery runner invariants hold",
  );

  console.log(
    `✓ payments tested: ${batch.payments.length}`,
  );

  console.log(
    `✓ recovered: ${recovered}`,
  );

  console.log(
    `✓ stopped safely: ${stopped}`,
  );

  console.log(
    `✓ human escalations: ${escalated}`,
  );

  console.log(
    `✓ reconciliation stops: ${reconciled}`,
  );
}

main().catch(
  (error: unknown) => {
    console.error(
      "✗ recovery runner check failed",
    );

    console.error(error);

    process.exitCode = 1;
  },
);