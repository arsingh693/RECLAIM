import {
  RunMetrics,
} from "../src/domain/types";

import {
  StrategyComparison,
} from "../src/metrics/runMetrics";

import { runExperiment } from "../src/experiments/runExperiment";

import {
  createSimulatedPaymentGateway,
} from "../src/gateway/simulatedGateway";

async function main(): Promise<void> {
  const seed =
    process.env.RECLAIM_SEED ??
    "reclaim-demo";

  const size = Number(
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

  const result =
    await runExperiment(
      () =>
        createSimulatedPaymentGateway({
          seed,
        }),
      {
        seed,
        size,
      },
    );

  console.log("");
  console.log(
    "========================================",
  );
  console.log(
    "           RECLAIM EXPERIMENT",
  );
  console.log(
    "========================================",
  );

  console.log("");
  console.log(
    `Seed: ${result.seed}`,
  );

  console.log(
    `Payments: ${result.payments.length}`,
  );

  console.log("");
  console.log(
    "--------------- BASELINE ---------------",
  );

  printMetrics(result.baseline);

  console.log("");
  console.log(
    "---------------- RECLAIM ----------------",
  );

  printMetrics(result.agent);

  console.log("");
  console.log(
    "--------------- COMPARISON --------------",
  );

  printComparison(result.comparison);

  console.log("");
  console.log(
    "✓ experiment completed",
  );
  console.log("");
}

/**
 * Print the metrics for one strategy.
 *
 * CHANGE:
 * This previously used StrategyComparison as its parameter type,
 * but the function actually receives RunMetrics.
 */
function printMetrics(
  metrics: RunMetrics,
): void {
  const recoveryRate =
    metrics.atRiskPaise === 0
      ? 0
      : metrics.recoveredPaise /
        metrics.atRiskPaise;

  console.log(
    `Recovery rate: ${formatPercent(
      recoveryRate,
    )}`,
  );

  console.log(
    `Recovered amount: ${formatPaise(
      metrics.recoveredPaise,
    )}`,
  );

  console.log(
    `Attempts: ${metrics.totalAttempts}`,
  );

  console.log(
    `Customer contacts: ${metrics.customerContacts}`,
  );

  console.log(
    `Human escalations: ${metrics.escalatedToHuman}`,
  );

  console.log(
    `Guardrail blocks: ${metrics.blockedByGuardrails}`,
  );

  console.log(
    `Wasted contacts: ${metrics.wastedContacts}`,
  );
}

/**
 * Print the comparison between baseline and RECLAIM.
 *
 * CHANGE:
 * Field names now exactly match StrategyComparison
 * from src/metrics/runMetrics.ts.
 */
function printComparison(
  comparison: StrategyComparison,
): void {
  console.log(
    `Recovery-rate improvement: ${formatPercent(
      comparison.recoveryImprovementPercent /
        100,
    )}`,
  );

  console.log(
    `Recovered-amount difference: ${formatPaise(
      comparison.recoveredDifferencePaise,
    )}`,
  );

  console.log(
    `Additional attempts: ${comparison.attemptDifference}`,
  );

  console.log(
    `Additional customer contacts: ${comparison.contactDifference}`,
  );

  console.log(
    `Guardrail-block difference: ${comparison.guardrailDifference}`,
  );
}

function formatPercent(
  value: number,
): string {
  if (!Number.isFinite(value)) {
    return "∞";
  }

  return `${(
    value * 100
  ).toFixed(2)}%`;
}

function formatPaise(
  paise: number,
): string {
  return `₹${(
    paise / 100
  ).toFixed(2)}`;
}

main().catch(
  (error: unknown) => {
    console.error(
      "✗ experiment failed",
    );
    console.error(error);
    process.exitCode = 1;
  },
);