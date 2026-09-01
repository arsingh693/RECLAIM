import {
  FailedPayment,
  RunMetrics,
} from "../domain/types";

import {
  PaymentGateway,
} from "../gateway/types";

import {
  generateSeedBatch,
} from "../data/seedBatch";

import {
  runRecovery,
} from "../orchestration/recoveryRunner";

import {
  runBaselineForPayment,
  BaselineRunRecord,
} from "../strategies/baselineStrategy";

import {
  calculateRunMetrics,
  compareStrategies,
  PaymentRunRecord,
  StrategyComparison,
} from "../metrics/runMetrics";

import {
  StubAIProvider,
} from "../ai/stubProvider";

export interface ExperimentOptions {
  readonly seed?: string;
  readonly size?: number;
  readonly baseDate?: string;
}

export interface ExperimentResult {
  readonly seed: string;
  readonly payments: readonly FailedPayment[];
  readonly baseline: RunMetrics;
  readonly agent: RunMetrics;
  readonly comparison: StrategyComparison;
}

/**
 * Run the complete RECLAIM experiment.
 *
 * Both strategies receive the EXACT same seeded payments.
 *
 *              SAME INPUT
 *                   │
 *          ┌────────┴────────┐
 *          ▼                 ▼
 *       BASELINE          RECLAIM
 *          │                 │
 *     fixed ladder      adaptive loop
 *          │                 │
 *          └────────┬────────┘
 *                   ▼
 *                METRICS
 *
 * The baseline and RECLAIM gateway instances are independent,
 * but both operate on the exact same seeded payment population.
 */
export async function runExperiment(
  gatewayFactory: () => PaymentGateway,
  options: ExperimentOptions = {},
): Promise<ExperimentResult> {
  const batch =
    generateSeedBatch({
      seed: options.seed,
      size: options.size,
      baseDate: options.baseDate,
    });

  const baselineGateway =
    gatewayFactory();

  const agentGateway =
    gatewayFactory();

  /**
   * The simulator has an internal payment registry because the
   * canonical PaymentGateway charge interface intentionally receives
   * only a narrow ChargeRequest.
   *
   * Register the exact same batch with both independent gateways.
   *
   * Production gateways do not need this simulator-specific operation.
   */
  registerBatchIfSupported(
    baselineGateway,
    batch.payments,
  );

  registerBatchIfSupported(
    agentGateway,
    batch.payments,
  );

  /**
   * Use the deterministic provider for benchmark runs.
   *
   * This keeps the benchmark reproducible. Gemini can be exercised
   * separately using the same recovery pipeline.
   */
  const aiProvider =
    new StubAIProvider();

  const baselineRecords:
    BaselineRunRecord[] = [];

  const agentRecords:
    PaymentRunRecord[] = [];

  /**
   * ---------------- BASELINE ----------------
   */
  for (const payment of batch.payments) {
    const record =
      await runBaselineForPayment(
        payment,
        baselineGateway,
      );

    baselineRecords.push(
      record,
    );
  }

  /**
   * ---------------- RECLAIM ----------------
   *
   * IMPORTANT:
   *
   * This uses runRecovery(), not orchestratePayment().
   *
   * Therefore RECLAIM can:
   *
   *     decide → attempt → decline → re-decide
   *
   * while respecting the deterministic guardrails and
   * attempt ceilings.
   */
  for (const payment of batch.payments) {
    const recovery =
      await runRecovery(
        payment,
        {
          gateway:
            agentGateway,
          aiProvider,
          maxTransitions: 8,
        },
      );

    const customerContacts =
      recovery.auditTrail.reduce(
        (total, entry) =>
          total +
          (
            isCustomerContact(
              entry.decision.intervention,
            )
              ? 1
              : 0
          ),
        0,
      );

    agentRecords.push({
      payment,
      outcomes:
        recovery.outcomes,
      blockedByGuardrails:
        recovery.guardrailBlocks,
      escalatedToHuman:
        recovery.humanEscalations,
      customerContacts,
    });
  }

  const baseline =
    calculateRunMetrics(
      "baseline",
      batch.seed,
      batch.payments,
      baselineRecords,
    );

  const agent =
    calculateRunMetrics(
      "agent",
      batch.seed,
      batch.payments,
      agentRecords,
    );

  const comparison =
    compareStrategies(
      baseline,
      agent,
    );

  return {
    seed: batch.seed,
    payments:
      batch.payments,
    baseline,
    agent,
    comparison,
  };
}

/**
 * Register the complete payment population with a simulator
 * without putting simulator-specific methods into the public
 * PaymentGateway contract.
 */
function registerBatchIfSupported(
  gateway: PaymentGateway,
  payments: readonly FailedPayment[],
): void {
  const candidate =
    gateway as PaymentGateway & {
      registerPayment?: (
        payment: FailedPayment,
      ) => void;
    };

  if (
    typeof candidate.registerPayment !==
    "function"
  ) {
    return;
  }

  for (const payment of payments) {
    candidate.registerPayment(
      payment,
    );
  }
}

/**
 * Customer-facing interventions count as contacts.
 *
 * This lets the metrics layer measure the cost side of recovery.
 */
function isCustomerContact(
  intervention: string,
): boolean {
  return (
    intervention ===
      "NUDGE_THEN_RETRY" ||
    intervention ===
      "REQUEST_INSTRUMENT_UPDATE" ||
    intervention ===
      "REQUEST_REAUTHORIZATION"
  );
}