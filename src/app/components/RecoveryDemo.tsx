"use client";

import { useState } from "react";

interface DemoOutcome {
  readonly paymentId: string;
  readonly succeeded: boolean;
  readonly recoveredPaise: number;
  readonly declineCode: string | null;
  readonly gatewayReference: string | null;
  readonly attemptedAt: string;
  readonly indeterminate: boolean;
}

interface DemoAuditEntry {
  readonly paymentId: string;
  readonly decision: {
    readonly intervention: string;
    readonly reasoning: string;
    readonly source: "llm" | "fallback";
  };
  readonly guardrail: {
    readonly allowed: boolean;
    readonly blockedBy: readonly string[];
    readonly notes: readonly string[];
  };
  readonly outcome: DemoOutcome | null;
}

interface DemoResult {
  readonly payment: {
    readonly id: string;
    readonly amountPaise: number;
    readonly method: string;
    readonly declineCode: string;
    readonly attemptsSoFar: number;
    readonly customer: {
      readonly successfulChargesLifetime: number;
    };
    readonly mandateCeilingPaise: number | null;
  };

  readonly finalPayment: {
    readonly declineCode: string;
    readonly attemptsSoFar: number;
  };

  readonly outcomes: readonly DemoOutcome[];

  readonly decisionsMade: number;
  readonly guardrailBlocks: number;
  readonly aiFallbacks: number;
  readonly humanEscalations: number;
  readonly stopReason: string;
  readonly auditTrail: readonly DemoAuditEntry[];
}

interface RecoveryResponse {
  readonly scenario: string;
  readonly customerLabel: string;
  readonly result: DemoResult;
}

const SCENARIOS = [
  {
    id: "insufficient_funds",
    label: "Insufficient funds",
  },
  {
    id: "issuer_unavailable",
    label: "Issuer unavailable",
  },
  {
    id: "gateway_timeout",
    label: "Gateway timeout",
  },
  {
    id: "risk_blocked",
    label: "Risk blocked",
  },
  {
    id: "mandate_limit",
    label: "Mandate limit exceeded",
  },
] as const;

type ScenarioId = (typeof SCENARIOS)[number]["id"];

function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatOutcome(outcome: DemoOutcome): string {
  if (outcome.indeterminate) {
    return "Indeterminate";
  }

  if (outcome.succeeded) {
    return "Recovered";
  }

  return outcome.declineCode ?? "Declined";
}

export default function RecoveryDemo() {
  const [scenario, setScenario] =
    useState<ScenarioId>("insufficient_funds");

  const [response, setResponse] =
    useState<RecoveryResponse | null>(null);

  const [loading, setLoading] = useState(false);

  const [error, setError] =
    useState<string | null>(null);

  async function runDemo(): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const result = await fetch("/api/recovery-demo", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scenario,
        }),
      });

      const body = (await result.json()) as
        | RecoveryResponse
        | {
            error: string;
          };

      if (!result.ok || "error" in body) {
        throw new Error(
          "error" in body
            ? body.error
            : "Recovery demo failed",
        );
      }

      setResponse(body);
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Recovery demo failed",
      );
    } finally {
      setLoading(false);
    }
  }

  const demo = response?.result ?? null;

  return (
    <div className="recovery-demo">
      {/* ─────────────────────────────────────
          CONTROL BAR
      ───────────────────────────────────── */}

      <div className="demo-toolbar">
        <div className="demo-selector-group">
          <label
            htmlFor="recovery-scenario"
            className="demo-toolbar-label"
          >
            DEMO SCENARIO
          </label>

          <select
            id="recovery-scenario"
            className="demo-select"
            value={scenario}
            onChange={(event) =>
              setScenario(
                event.target.value as ScenarioId,
              )
            }
            disabled={loading}
          >
            {SCENARIOS.map((item) => (
              <option
                key={item.id}
                value={item.id}
              >
                {item.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          className="demo-run-button"
          onClick={runDemo}
          disabled={loading}
        >
          <span>
            {loading
              ? "Evaluating..."
              : "Evaluate recovery"}
          </span>

          {!loading && (
            <span
              aria-hidden="true"
              className="demo-button-arrow"
            >
              →
            </span>
          )}
        </button>
      </div>

      {/* ─────────────────────────────────────
          ERROR
      ───────────────────────────────────── */}

      {error && (
        <div className="demo-error">
          <div className="demo-error-icon">!</div>

          <div>
            <strong>Demo error</strong>
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────
          EMPTY STATE
      ───────────────────────────────────── */}

      {!demo && !loading && !error && (
        <div className="demo-empty">
          <div className="demo-empty-mark">
            →
          </div>

          <div className="demo-empty-copy">
            <strong>
              Select a failure and run RECLAIM.
            </strong>

            <p>
              The result below comes from the actual
              recovery engine, not a mocked UI response.
            </p>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────
          LOADING
      ───────────────────────────────────── */}

      {loading && (
        <div className="demo-loading">
          <div className="loading-pulse" />

          <div>
            <strong>
              RECLAIM is evaluating this payment.
            </strong>

            <p>
              Policy <span>→</span> AI <span>→</span>{" "}
              guardrails <span>→</span> executor{" "}
              <span>→</span> gateway
            </p>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────
          RESULT
      ───────────────────────────────────── */}

      {demo && response && (
        <div className="demo-result-shell">
          {/* PAYMENT OVERVIEW */}

          <div className="demo-summary">
            <div className="demo-summary-payment">
              <span className="field-label">
                PAYMENT
              </span>

              <strong className="demo-payment-id">
                {demo.payment.id}
              </strong>

              <span className="demo-method">
                {demo.payment.method}
              </span>
            </div>

            <div className="demo-summary-amount">
              <span className="field-label">
                AMOUNT
              </span>

              <strong className="demo-amount">
                {formatPaise(
                  demo.payment.amountPaise,
                )}
              </strong>
            </div>

            <div className="demo-summary-decline">
              <span className="field-label">
                DECLINE
              </span>

              <strong className="demo-decline">
                {demo.payment.declineCode}
              </strong>
            </div>
          </div>

          {/* CUSTOMER SIGNAL */}

          <div className="demo-customer">
            <div className="demo-customer-copy">
              <span className="field-label">
                CUSTOMER SIGNAL
              </span>

              <strong>
                {response.customerLabel}
              </strong>
            </div>

            <div className="demo-customer-stat">
              <strong>
                {
                  demo.payment.customer
                    .successfulChargesLifetime
                }
              </strong>

              <span>
                successful charges
              </span>
            </div>
          </div>

          {/* RECOVERY TRACE */}

          <div className="demo-trace">
            <div className="demo-trace-header">
              <div>
                <span className="field-label">
                  RECOVERY TRACE
                </span>

                <strong>
                  Decision path
                </strong>
              </div>

              <span className="demo-trace-meta">
                {demo.decisionsMade} decisions
                <span>·</span>
                {demo.outcomes.length} attempts
              </span>
            </div>

            <div className="demo-events">
              {demo.auditTrail.map(
                (entry, index) => {
                  const outcome =
                    entry.outcome;

                  const isBlocked =
                    !entry.guardrail.allowed;

                  const isSuccess =
                    outcome?.succeeded === true;

                  const isReconcile =
                    entry.decision.intervention ===
                    "RECONCILE_THEN_DECIDE";

                  const isLast =
                    index ===
                    demo.auditTrail.length - 1;

                  const eventClass = [
                    "demo-event",
                    isBlocked ? "blocked" : "",
                    isSuccess ? "success" : "",
                    isReconcile
                      ? "reconcile"
                      : "",
                    !isBlocked &&
                    !isSuccess &&
                    !isReconcile &&
                    isLast
                      ? "active"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ");

                  return (
                    <div
                      className={eventClass}
                      key={`${entry.paymentId}-${index}`}
                    >
                      <div className="demo-event-number">
                        {String(index + 1).padStart(
                          2,
                          "0",
                        )}
                      </div>

                      <div className="demo-event-main">
                        <div className="demo-event-heading">
                          <span className="demo-event-type">
                            {
                              entry.decision
                                .intervention
                            }
                          </span>

                          <strong>
                            {entry.guardrail
                              .allowed
                              ? outcome
                                ? formatOutcome(
                                    outcome,
                                  )
                                : "Decision accepted"
                              : "Blocked by guardrail"}
                          </strong>
                        </div>

                        <p>
                          {entry.guardrail
                            .allowed
                            ? entry.decision
                                .reasoning
                            : entry.guardrail
                                .blockedBy
                                .join(" · ")}
                        </p>
                      </div>

                      <span
                        className={`demo-event-state ${
                          entry.guardrail.allowed
                            ? "pass"
                            : "block"
                        }`}
                      >
                        {entry.guardrail.allowed
                          ? "PASS"
                          : "BLOCK"}
                      </span>
                    </div>
                  );
                },
              )}
            </div>
          </div>

          {/* FINAL RESULT */}

          <div className="demo-result">
            <div className="demo-final-state">
              <span className="field-label">
                FINAL STATE
              </span>

              <strong>
                {demo.stopReason}
              </strong>
            </div>

            <div>
              <span className="field-label">
                RECOVERED
              </span>

              <strong className="demo-result-money">
                {formatPaise(
                  demo.outcomes.reduce(
                    (total, outcome) =>
                      total +
                      outcome.recoveredPaise,
                    0,
                  ),
                )}
              </strong>
            </div>

            <div>
              <span className="field-label">
                GUARDRAIL BLOCKS
              </span>

              <strong>
                {demo.guardrailBlocks}
              </strong>
            </div>

            <div>
              <span className="field-label">
                AI FALLBACKS
              </span>

              <strong>
                {demo.aiFallbacks}
              </strong>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}