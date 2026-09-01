import {
  AttemptOutcome,
  FailedPayment,
  RunMetrics,
  RunStrategy,
} from "../domain/types";

/**
 * One completed payment execution.
 *
 * Keeping this separate from RunMetrics lets the metrics layer
 * remain a pure aggregation function.
 */
export interface PaymentRunRecord {
  readonly payment: FailedPayment;
  readonly outcomes: readonly AttemptOutcome[];
  readonly blockedByGuardrails: number;
  readonly escalatedToHuman: number;
  readonly customerContacts: number;
}

/**
 * Calculate headline metrics for one strategy.
 *
 * Important:
 * - Amounts are always integer paise.
 * - We derive all money figures from the payment batch and
 *   gateway outcomes.
 * - No metric is supplied manually by the UI.
 */
export function calculateRunMetrics(
  strategy: RunStrategy,
  batchSeed: string,
  payments: readonly FailedPayment[],
  records: readonly PaymentRunRecord[],
): RunMetrics {
  const atRiskPaise = payments.reduce(
    (total, payment) =>
      total + payment.amountPaise,
    0,
  );

  const recoveredPaise = records.reduce(
    (total, record) =>
      total +
      record.outcomes.reduce(
        (sum, outcome) =>
          sum + outcome.recoveredPaise,
        0,
      ),
    0,
  );

  const recoveredCount = records.filter(
    (record) =>
      record.outcomes.some(
        (outcome) =>
          outcome.succeeded &&
          outcome.recoveredPaise > 0,
      ),
  ).length;

  const totalAttempts = records.reduce(
    (total, record) =>
      total + record.outcomes.length,
    0,
  );

  const blockedByGuardrails =
    records.reduce(
      (total, record) =>
        total +
        record.blockedByGuardrails,
      0,
    );

  const escalatedToHuman =
    records.reduce(
      (total, record) =>
        total +
        record.escalatedToHuman,
      0,
    );

  const customerContacts =
    records.reduce(
      (total, record) =>
        total +
        record.customerContacts,
      0,
    );

  /**
   * A wasted contact is any customer contact that
   * did not result in recovery.
   *
   * This gives us an important cost-side metric:
   * maximizing recovered money isn't enough if the
   * strategy spams customers.
   */
  const wastedContacts =
    records.reduce(
      (total, record) => {
        const recovered =
          record.outcomes.some(
            (outcome) =>
              outcome.succeeded &&
              outcome.recoveredPaise > 0,
          );

        if (
          !recovered &&
          record.customerContacts > 0
        ) {
          return (
            total +
            record.customerContacts
          );
        }

        return total;
      },
      0,
    );

  return {
    strategy,
    batchSeed,
    paymentsInBatch:
      payments.length,
    atRiskPaise,
    recoveredPaise,
    recoveredCount,
    totalAttempts,
    blockedByGuardrails,
    escalatedToHuman,
    customerContacts,
    wastedContacts,
  };
}

/**
 * Compare two strategies operating on the same batch.
 *
 * This is deliberately expressed as arithmetic over independently
 * generated metrics. The comparison layer does not know how either
 * strategy made its decisions.
 */
export interface StrategyComparison {
  readonly baseline: RunMetrics;
  readonly agent: RunMetrics;
  readonly recoveredDifferencePaise: number;
  readonly recoveryImprovementPercent: number;
  readonly attemptDifference: number;
  readonly guardrailDifference: number;
  readonly contactDifference: number;
}

export function compareStrategies(
  baseline: RunMetrics,
  agent: RunMetrics,
): StrategyComparison {
  if (
    baseline.batchSeed !==
    agent.batchSeed
  ) {
    throw new Error(
      "Cannot compare strategies from different batch seeds",
    );
  }

  if (
    baseline.paymentsInBatch !==
    agent.paymentsInBatch
  ) {
    throw new Error(
      "Cannot compare strategies with different batch sizes",
    );
  }

  if (
    baseline.atRiskPaise !==
    agent.atRiskPaise
  ) {
    throw new Error(
      "Cannot compare strategies with different amounts at risk",
    );
  }

  const recoveredDifferencePaise =
    agent.recoveredPaise -
    baseline.recoveredPaise;

  const recoveryImprovementPercent =
    baseline.recoveredPaise === 0
      ? agent.recoveredPaise > 0
        ? Infinity
        : 0
      : (recoveredDifferencePaise /
          baseline.recoveredPaise) *
        100;

  return {
    baseline,
    agent,
    recoveredDifferencePaise,
    recoveryImprovementPercent,
    attemptDifference:
      agent.totalAttempts -
      baseline.totalAttempts,
    guardrailDifference:
      agent.blockedByGuardrails -
      baseline.blockedByGuardrails,
    contactDifference:
      agent.customerContacts -
      baseline.customerContacts,
  };
}

/**
 * Convert a comparison into a compact human-readable summary.
 *
 * The dashboard and eventual submission video can use the same
 * computed numbers instead of independently reimplementing the
 * calculations.
 */
export function summarizeComparison(
  comparison: StrategyComparison,
): string {
  const improvement =
    Number.isFinite(
      comparison.recoveryImprovementPercent,
    )
      ? `${comparison.recoveryImprovementPercent.toFixed(1)}%`
      : "∞";

  return [
    `Batch: ${comparison.agent.batchSeed}`,
    `Payments: ${comparison.agent.paymentsInBatch}`,
    `Amount at risk: ${comparison.agent.atRiskPaise} paise`,
    `Baseline recovered: ${comparison.baseline.recoveredPaise} paise`,
    `RECLAIM recovered: ${comparison.agent.recoveredPaise} paise`,
    `Recovery improvement: ${improvement}`,
    `Baseline attempts: ${comparison.baseline.totalAttempts}`,
    `RECLAIM attempts: ${comparison.agent.totalAttempts}`,
    `Guardrail blocks: ${comparison.agent.blockedByGuardrails}`,
    `Customer contact delta: ${comparison.contactDifference}`,
  ].join("\n");
}