import {
  AuditEntry,
  AttemptOutcome,
  Decision,
  FailedPayment,
  GuardrailVerdict,
} from "../domain/types";

/**
 * In-memory audit trail for one orchestration run.
 *
 * The audit trail is deliberately append-only.
 *
 * We never mutate an existing entry. This gives us a deterministic sequence
 * that can later be persisted to a database without changing the domain model.
 */
export class AuditTrail {
  private readonly entries: AuditEntry[] = [];
  private nextSequence = 1;

  /**
   * Record the result of one decision.
   *
   * Every decision gets exactly one audit entry, including decisions that:
   * - were blocked by guardrails
   * - did not produce a gateway attempt
   * - succeeded
   * - failed
   * - produced an indeterminate result
   */
  append(
    payment: FailedPayment,
    decision: Decision,
    guardrail: GuardrailVerdict,
    outcome: AttemptOutcome | null,
  ): AuditEntry {
    const entry: AuditEntry = {
      sequence: this.nextSequence,
      paymentId: payment.id,
      at: decision.decidedAt,

      inputSnapshot: {
        declineCode: payment.declineCode,
        amountPaise: payment.amountPaise,
        attemptsSoFar: payment.attemptsSoFar,
        method: payment.method,
      },

      decision,
      guardrail,
      outcome,

      reversible: determineReversibility(
        decision,
        outcome,
      ),
    };

    this.entries.push(entry);
    this.nextSequence += 1;

    return entry;
  }

  /**
   * Return a read-only snapshot.
   *
   * Callers cannot mutate the underlying audit trail through this reference.
   */
  snapshot(): readonly AuditEntry[] {
    return [...this.entries];
  }

  /**
   * Return all events belonging to one payment.
   */
  forPayment(
    paymentId: string,
  ): readonly AuditEntry[] {
    return this.entries.filter(
      (entry) =>
        entry.paymentId === paymentId,
    );
  }

  /**
   * Number of audit events recorded so far.
   */
  get size(): number {
    return this.entries.length;
  }

  /**
   * Last sequence number, or 0 for an empty trail.
   */
  get lastSequence(): number {
  if (this.entries.length === 0) {
    return 0;
  }

  const lastEntry =
    this.entries[this.entries.length - 1];

  return lastEntry?.sequence ?? 0;
}
}

/**
 * Determines whether the action represented by an audit entry can be
 * meaningfully reversed.
 *
 * This is intentionally conservative.
 *
 * A successful charge is NOT considered reversible merely because a refund
 * might technically be possible. A refund is a separate financial operation
 * and must not be silently implied by this field.
 */
function determineReversibility(
  decision: Decision,
  outcome: AttemptOutcome | null,
): boolean {
  if (!outcome) {
    return false;
  }

  if (!outcome.succeeded) {
    return false;
  }

  switch (decision.intervention) {
    case "REQUEST_INSTRUMENT_UPDATE":
    case "REQUEST_REAUTHORIZATION":
    case "NUDGE_THEN_RETRY":
      return true;

    case "RETRY_NOW":
    case "RETRY_SCHEDULED":
    case "RETRY_ALTERNATE_RAIL":
    case "RETRY_SPLIT_AMOUNT":
      /*
       * A successful charge has already moved money.
       * Treating that as automatically reversible would be misleading.
       */
      return false;

    case "RECONCILE_THEN_DECIDE":
    case "ESCALATE_HUMAN":
    case "STOP_PERMANENT":
      return false;

    default:
      return false;
  }
}

/**
 * Build a concise human-readable audit summary.
 *
 * The console can use this without knowing the internal structure of the
 * audit objects.
 */
export function summarizeAuditEntry(
  entry: AuditEntry,
): string {
  const status =
    entry.guardrail.allowed
      ? entry.outcome
        ? entry.outcome.succeeded
          ? "SUCCEEDED"
          : entry.outcome.indeterminate
            ? "INDETERMINATE"
            : "DECLINED"
        : "NO_GATEWAY_ACTION"
      : "BLOCKED";

  return [
    `#${entry.sequence}`,
    entry.paymentId,
    entry.decision.intervention,
    status,
  ].join(" | ");
}

/**
 * Validate the structural invariants of an audit trail.
 *
 * This is intentionally independent of the policy and gateway so it can be
 * reused by automated checks and later by the UI.
 */
export function validateAuditTrail(
  entries: readonly AuditEntry[],
): void {
  let expectedSequence = 1;

  for (const entry of entries) {
    if (entry.sequence !== expectedSequence) {
      throw new Error(
        `Audit sequence gap: expected ${expectedSequence}, got ${entry.sequence}`,
      );
    }

    if (!entry.paymentId) {
      throw new Error(
        "Audit entry must have a payment ID",
      );
    }

    if (!entry.decision.paymentId) {
      throw new Error(
        `Audit entry #${entry.sequence} has a decision without a payment ID`,
      );
    }

    if (
      entry.decision.paymentId !==
      entry.paymentId
    ) {
      throw new Error(
        `Audit entry #${entry.sequence}: payment ID mismatch`,
      );
    }

    if (
      entry.guardrail.allowed === false &&
      entry.outcome !== null
    ) {
      throw new Error(
        `Audit entry #${entry.sequence}: blocked decision cannot have a gateway outcome`,
      );
    }

    if (
      entry.outcome !== null &&
      !entry.guardrail.allowed
    ) {
      throw new Error(
        `Audit entry #${entry.sequence}: blocked action cannot reach gateway`,
      );
    }

    expectedSequence += 1;
  }
}