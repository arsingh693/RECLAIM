import {
  generateSeedBatch,
} from "../src/data/seedBatch";

import {
  createSimulatedPaymentGateway,
} from "../src/gateway/simulatedGateway";

import {
  StubAIProvider,
} from "../src/ai/stubProvider";

import {
  runRecovery,
} from "../src/orchestration/recoveryRunner";

interface BlockStats {
  count: number;
  payments: Set<string>;
}

interface InterventionStats {
  decisions: number;
  recovered: number;
  blocked: number;
  fallbacks: number;
}

async function main(): Promise<void> {
  const seed =
    process.env.RECLAIM_SEED ??
    "reclaim-proof-001";

  const size =
    Number(
      process.env.RECLAIM_SIZE ??
        "100",
    );

  if (
    !Number.isInteger(size) ||
    size <= 0
  ) {
    throw new Error(
      "RECLAIM_SIZE must be a positive integer",
    );
  }

  const batch =
    generateSeedBatch({
      seed,
      size,
    });

  const gateway =
    createSimulatedPaymentGateway({
      seed,
    });

  /**
   * The simulator keeps FailedPayment state internally while the public
   * PaymentGateway interface receives only ChargeRequest.
   *
   * The simulator exposes registerPayment as a concrete development-only
   * capability without putting it into the production gateway interface.
   */
  const simulator =
    gateway as typeof gateway & {
      registerPayment?: (
        payment: typeof batch.payments[number],
      ) => void;
    };

  if (
    typeof simulator.registerPayment ===
    "function"
  ) {
    for (
      const payment of batch.payments
    ) {
      simulator.registerPayment(
        payment,
      );
    }
  }

  const aiProvider =
    new StubAIProvider();

  const blockStats =
    new Map<string, BlockStats>();

  const interventionStats =
    new Map<
      string,
      InterventionStats
    >();

  const declineStats =
    new Map<
      string,
      {
        payments: number;
        recovered: number;
        attempts: number;
        blocks: number;
      }
    >();

  const stopReasons =
    new Map<string, number>();

  let totalDecisions = 0;
  let totalBlocks = 0;
  let totalAttempts = 0;
  let totalRecoveredPaise = 0;
  let totalFallbacks = 0;

  for (
    const payment of batch.payments
  ) {
    const result =
      await runRecovery(
        payment,
        {
          gateway,
          aiProvider,
          maxTransitions: 8,
        },
      );

    totalDecisions +=
      result.decisionsMade;

    totalBlocks +=
      result.guardrailBlocks;

    totalAttempts +=
      result.outcomes.length;

    totalRecoveredPaise +=
      result.outcomes.reduce(
        (total, outcome) =>
          total +
          outcome.recoveredPaise,
        0,
      );

    totalFallbacks +=
      result.aiFallbacks;

    stopReasons.set(
      result.stopReason,
      (
        stopReasons.get(
          result.stopReason,
        ) ?? 0
      ) + 1,
    );

    const declineEntry =
      declineStats.get(
        payment.declineCode,
      ) ?? {
        payments: 0,
        recovered: 0,
        attempts: 0,
        blocks: 0,
      };

    declineEntry.payments += 1;
    declineEntry.attempts +=
      result.outcomes.length;

    declineEntry.recovered +=
      result.outcomes.reduce(
        (total, outcome) =>
          total +
          outcome.recoveredPaise,
        0,
      );

    declineEntry.blocks +=
      result.guardrailBlocks;

    declineStats.set(
      payment.declineCode,
      declineEntry,
    );

    for (
      const entry of result.auditTrail
    ) {
      const intervention =
        entry.decision.intervention;

      const existing =
        interventionStats.get(
          intervention,
        ) ?? {
          decisions: 0,
          recovered: 0,
          blocked: 0,
          fallbacks: 0,
        };

      existing.decisions += 1;

      if (
        entry.outcome?.succeeded
      ) {
        existing.recovered += 1;
      }

      if (
        !entry.guardrail.allowed
      ) {
        existing.blocked += 1;
      }

      if (
        entry.decision.source ===
        "fallback"
      ) {
        existing.fallbacks += 1;
      }

      interventionStats.set(
        intervention,
        existing,
      );

      for (
        const reason of
        entry.guardrail.blockedBy
      ) {
        const stats =
          blockStats.get(
            reason,
          ) ?? {
            count: 0,
            payments: new Set<string>(),
          };

        stats.count += 1;
        stats.payments.add(
          entry.paymentId,
        );

        blockStats.set(
          reason,
          stats,
        );
      }
    }
  }

  console.log("");
  console.log(
    "========================================",
  );
  console.log(
    "           RECLAIM PROOF REPORT",
  );
  console.log(
    "========================================",
  );

  console.log("");
  console.log(
    `Seed: ${seed}`,
  );

  console.log(
    `Payments: ${batch.payments.length}`,
  );

  console.log(
    `Decisions: ${totalDecisions}`,
  );

  console.log(
    `Attempts: ${totalAttempts}`,
  );

  console.log(
    `Recovered: ₹${(
      totalRecoveredPaise / 100
    ).toLocaleString(
      "en-IN",
      {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      },
    )}`,
  );

  console.log(
    `AI fallbacks: ${totalFallbacks}`,
  );

  console.log("");
  console.log(
    "------------ GUARDRAIL BLOCKS ------------",
  );

  if (
    blockStats.size === 0
  ) {
    console.log(
      "No guardrail blocks.",
    );
  } else {
    const sortedBlocks =
      Array.from(
        blockStats.entries(),
      ).sort(
        (a, b) =>
          b[1].count -
          a[1].count,
      );

    for (
      const [
        reason,
        stats,
      ] of sortedBlocks
    ) {
      console.log(
        `${reason}: ${stats.count} blocks across ${stats.payments.size} payments`,
      );
    }
  }

  console.log("");
  console.log(
    "---------- INTERVENTION PROOF -----------",
  );

  const sortedInterventions =
    Array.from(
      interventionStats.entries(),
    ).sort(
      (a, b) =>
        b[1].decisions -
        a[1].decisions,
    );

  for (
    const [
      intervention,
      stats,
    ] of sortedInterventions
  ) {
    console.log(
      [
        intervention,
        `decisions=${stats.decisions}`,
        `recovered=${stats.recovered}`,
        `blocked=${stats.blocked}`,
        `fallbacks=${stats.fallbacks}`,
      ].join(" | "),
    );
  }

  console.log("");
  console.log(
    "------------ DECLINE PROOF ------------",
  );

  for (
    const [
      declineCode,
      stats,
    ] of Array.from(
      declineStats.entries(),
    ).sort(
      (a, b) =>
        b[1].payments -
        a[1].payments,
    )
  ) {
    console.log(
      [
        declineCode,
        `payments=${stats.payments}`,
        `attempts=${stats.attempts}`,
        `recovered=₹${(
          stats.recovered / 100
        ).toFixed(2)}`,
        `blocks=${stats.blocks}`,
      ].join(" | "),
    );
  }

  console.log("");
  console.log(
    "------------- STOP REASONS -------------",
  );

  for (
    const [
      reason,
      count,
    ] of Array.from(
      stopReasons.entries(),
    ).sort(
      (a, b) =>
        b[1] -
        a[1],
    )
  ) {
    console.log(
      `${reason}: ${count}`,
    );
  }

  console.log("");
  console.log(
    "------------- SAFETY PROOF -------------",
  );

  const noNegativeRecovery =
    totalRecoveredPaise >= 0;

  const blocksAccountedFor =
    totalBlocks >=
    Array.from(
      blockStats.values(),
    ).reduce(
      (total, stats) =>
        total + stats.count,
      0,
    );

  const transitionsBounded =
    totalDecisions <=
    batch.payments.length * 8;

  console.log(
    `Non-negative recovered amount: ${noNegativeRecovery}`,
  );

  console.log(
    `Guardrail blocks accounted for: ${blocksAccountedFor}`,
  );

  console.log(
    `Decision transitions bounded: ${transitionsBounded}`,
  );

  if (
    !noNegativeRecovery ||
    !blocksAccountedFor ||
    !transitionsBounded
  ) {
    throw new Error(
      "Proof invariants failed",
    );
  }

  console.log("");
  console.log(
    "✓ proof report completed",
  );
  console.log("");
}

main().catch(
  (error: unknown) => {
    console.error(
      "✗ proof report failed",
    );

    console.error(error);

    process.exitCode = 1;
  },
);