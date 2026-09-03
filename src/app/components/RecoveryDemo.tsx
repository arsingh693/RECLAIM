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

interface RecoveryErrorResponse {
  readonly error: string;
}

const SCENARIOS = [
  {
    id: "insufficient_funds",
    label: "Insufficient funds",
    description: "Funds unavailable right now",
  },
  {
    id: "issuer_unavailable",
    label: "Issuer unavailable",
    description:
      "Bank or issuer is temporarily unavailable",
  },
  {
    id: "gateway_timeout",
    label: "Gateway timeout",
    description: "Payment outcome is unknown",
  },
  {
    id: "risk_blocked",
    label: "Risk blocked",
    description: "Risk controls stopped automation",
  },
  {
    id: "mandate_limit",
    label: "Mandate limit exceeded",
    description:
      "Charge exceeds authorization ceiling",
  },
] as const;

type ScenarioId =
  (typeof SCENARIOS)[number]["id"];

function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatOutcome(
  outcome: DemoOutcome,
): string {
  if (outcome.indeterminate) {
    return "Indeterminate";
  }

  if (outcome.succeeded) {
    return "Recovered";
  }

  return outcome.declineCode ?? "Declined";
}

function formatIntervention(
  intervention: string,
): string {
  switch (intervention) {
    case "RETRY_SCHEDULED":
      return "Scheduled retry";

    case "RETRY_NOW":
      return "Immediate retry";

    case "RETRY_ALTERNATE_RAIL":
      return "Alternate payment rail";

    case "RETRY_SPLIT_AMOUNT":
      return "Split amount";

    case "NUDGE_THEN_RETRY":
      return "Customer nudge";

    case "REQUEST_INSTRUMENT_UPDATE":
      return "Update payment instrument";

    case "REQUEST_REAUTHORIZATION":
      return "Request reauthorization";

    case "RECONCILE_THEN_DECIDE":
      return "Reconcile payment state";

    case "ESCALATE_HUMAN":
      return "Escalate to human";

    case "STOP_PERMANENT":
      return "Stop recovery";

    default:
      return intervention;
  }
}

function formatStopReason(
  reason: string,
): string {
  switch (reason) {
    case "RECOVERED":
      return "Payment recovered";

    case "PERMANENT_STOP":
      return "Recovery permanently stopped";

    case "HUMAN_ESCALATION":
      return "Human review required";

    case "NO_ACTION":
      return "No further action";

    case "RECONCILIATION_FAILED":
      return "Reconciliation failed";

    case "RECONCILIATION_STILL_UNKNOWN":
      return "Payment state still unknown";

    case "MAX_TRANSITIONS":
      return "Maximum transitions reached";

    default:
      return reason;
  }
}

function formatDecline(
  declineCode: string,
): string {
  switch (declineCode) {
    case "INSUFFICIENT_FUNDS":
      return "Insufficient funds";

    case "ISSUER_UNAVAILABLE":
      return "Issuer unavailable";

    case "GATEWAY_TIMEOUT":
      return "Gateway timeout";

    case "RISK_BLOCKED":
      return "Risk blocked";

    case "MANDATE_LIMIT_EXCEEDED":
      return "Mandate limit exceeded";

    case "CARD_EXPIRED":
      return "Card expired";

    case "CARD_BLOCKED":
      return "Card blocked";

    case "LIMIT_EXCEEDED":
      return "Transaction limit exceeded";

    case "AUTHENTICATION_FAILED":
      return "Authentication failed";

    case "DO_NOT_HONOUR":
      return "Issuer declined";

    case "MANDATE_PAUSED":
      return "Mandate paused";

    case "INVALID_INSTRUMENT":
      return "Invalid payment instrument";

    default:
      return declineCode;
  }
}

function describeEvent(
  entry: DemoAuditEntry,
  outcome: DemoOutcome | null,
): string {
  if (!entry.guardrail.allowed) {
    if (entry.guardrail.blockedBy.length > 0) {
      return entry.guardrail.blockedBy
        .map((reason) =>
          reason
            .toLowerCase()
            .replaceAll("_", " "),
        )
        .join(" · ");
    }

    return "Recovery action blocked by guardrails";
  }

  if (
    entry.decision.intervention ===
    "RECONCILE_THEN_DECIDE"
  ) {
    return "Unknown gateway state → reconcile before any new charge";
  }

  if (outcome?.succeeded) {
    return `Payment recovered${
      outcome.gatewayReference
        ? ` · ${outcome.gatewayReference}`
        : ""
    }`;
  }

  if (outcome?.indeterminate) {
    return "Gateway returned an indeterminate result → reconciliation required";
  }

  if (outcome) {
    return outcome.declineCode
      ? `${formatDecline(
          outcome.declineCode,
        )} → recovery policy reevaluated`
      : "Charge attempt declined → recovery policy reevaluated";
  }

  if (
    entry.decision.intervention ===
    "ESCALATE_HUMAN"
  ) {
    return "Automated recovery stopped → human review";
  }

  if (
    entry.decision.intervention ===
    "STOP_PERMANENT"
  ) {
    return "Hard stop → no further automated recovery";
  }

  return entry.decision.reasoning;
}

export default function RecoveryDemo() {
  const [scenario, setScenario] =
    useState<ScenarioId>(
      "insufficient_funds",
    );

  const [response, setResponse] =
    useState<RecoveryResponse | null>(
      null,
    );

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  async function runDemo(): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const result = await fetch(
        "/api/recovery-demo",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            scenario,
          }),
        },
      );

      const contentType =
        result.headers.get(
          "content-type",
        ) ?? "";

      const body = (
        contentType.includes(
          "application/json",
        )
          ? await result.json()
          : {
              error: await result.text(),
            }
      ) as
        | RecoveryResponse
        | RecoveryErrorResponse;

      if (
        !result.ok ||
        "error" in body
      ) {
        throw new Error(
          "error" in body
            ? body.error
            : "Recovery demo failed",
        );
      }

      setResponse(body);
    } catch (
      caughtError: unknown
    ) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Recovery demo failed",
      );
      setResponse(null);
    } finally {
      setLoading(false);
    }
  }

  const demo =
    response?.result ?? null;

  const selectedScenario =
    SCENARIOS.find(
      (item) =>
        item.id === scenario,
    );

  return (
    <div className="recovery-demo">
      {/* =================================================
          CONTROLS
          ================================================= */}
      <div className="demo-toolbar">
        <div className="demo-selector-group">
          <div>
            <span className="demo-toolbar-label">
              TEST SCENARIO
            </span>

            <strong className="demo-toolbar-heading">
              Choose a payment failure
            </strong>
          </div>

          <div className="demo-select-wrap">
            <select
              className="demo-select"
              value={scenario}
              onChange={(event) =>
                setScenario(
                  event.target
                    .value as ScenarioId,
                )
              }
              disabled={loading}
              aria-label="Choose recovery demo scenario"
            >
              {SCENARIOS.map(
                (item) => (
                  <option
                    key={item.id}
                    value={item.id}
                  >
                    {item.label}
                  </option>
                ),
              )}
            </select>

            {selectedScenario && (
              <span className="demo-select-description">
                {
                  selectedScenario.description
                }
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          className="demo-run-button"
          onClick={runDemo}
          disabled={loading}
        >
          {loading
            ? "Evaluating..."
            : "Evaluate recovery"}

          <span className="demo-button-arrow">
            →
          </span>
        </button>
      </div>

      {/* =================================================
          ERROR
          ================================================= */}
      {error && (
        <div className="demo-error">
          <div className="demo-error-icon">
            !
          </div>

          <div>
            <strong>
              Recovery evaluation failed
            </strong>

            <span>{error}</span>
          </div>
        </div>
      )}

      {/* =================================================
          EMPTY
          ================================================= */}
      {!demo &&
        !loading &&
        !error && (
          <div className="demo-empty">
            <div className="demo-empty-mark">
              →
            </div>

            <div className="demo-empty-copy">
              <strong>
                Ready to run RECLAIM.
              </strong>

              <p>
                Select a failure scenario
                and evaluate the actual
                recovery engine. Nothing
                here is a mocked response.
              </p>
            </div>

            <span className="demo-empty-status">
              READY
            </span>
          </div>
        )}

      {/* =================================================
          LOADING
          ================================================= */}
      {loading && (
        <div className="demo-loading">
          <div className="loading-pulse" />

          <div>
            <strong>
              RECLAIM is evaluating this
              payment.
            </strong>

            <p>
              Policy → AI → guardrails →
              executor → gateway
            </p>
          </div>
        </div>
      )}

      {/* =================================================
          RESULT
          ================================================= */}
      {demo && (
        <div className="demo-result-shell">
          {/* ---------------------------------------------
              RESULT HEADER
              --------------------------------------------- */}
          <div className="demo-result-header">
            <div>
              <span className="demo-result-kicker">
                RECOVERY RUN
              </span>

              <strong>
                {selectedScenario?.label ??
                  "Payment scenario"}
              </strong>
            </div>

            <span
              className={
                demo.stopReason ===
                "RECOVERED"
                  ? "demo-run-status success"
                  : demo.stopReason ===
                      "RECONCILIATION_STILL_UNKNOWN"
                    ? "demo-run-status warning"
                    : "demo-run-status"
              }
            >
              {demo.stopReason ===
              "RECOVERED"
                ? "RECOVERED"
                : demo.stopReason ===
                    "RECONCILIATION_STILL_UNKNOWN"
                  ? "RECONCILIATION"
                  : "RUN COMPLETE"}
            </span>
          </div>

          {/* ---------------------------------------------
              PAYMENT SUMMARY
              --------------------------------------------- */}
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
                FAILURE
              </span>

              <strong className="demo-decline">
                {formatDecline(
                  demo.payment
                    .declineCode,
                )}
              </strong>

              <span className="demo-technical-code">
                {demo.payment.declineCode}
              </span>
            </div>
          </div>

          {/* ---------------------------------------------
              CUSTOMER SIGNAL
              --------------------------------------------- */}
          <div className="demo-customer">
            <div className="demo-customer-copy">
              <span className="field-label">
                CUSTOMER SIGNAL
              </span>

              <strong>
                {response?.customerLabel ??
                  "Customer context available"}
              </strong>
            </div>

            <div className="demo-customer-stat">
              <strong>
                {
                  demo.payment
                    .customer
                    .successfulChargesLifetime
                }
              </strong>

              <span>
                successful charges
              </span>
            </div>
          </div>

          {/* ---------------------------------------------
              DECISION SUMMARY
              --------------------------------------------- */}
          {demo.auditTrail.length > 0 &&
  (() => {
    const lastAuditEntry =
      demo.auditTrail[
        demo.auditTrail.length - 1
      ];

    if (!lastAuditEntry) {
      return null;
    }

    return (
      <div className="demo-decision-summary">
        <div>
          <span className="field-label">
            CURRENT DECISION
          </span>

          <strong>
            {formatIntervention(
              lastAuditEntry.decision.intervention,
            )}
          </strong>
        </div>

        <div>
          <span className="field-label">
            DECISION SOURCE
          </span>

          <strong>
            {lastAuditEntry.decision.source}
          </strong>
        </div>

        <div>
          <span className="field-label">
            GUARDRAILS
          </span>

          <strong>
            {lastAuditEntry.guardrail.allowed
              ? "AUTHORIZED"
              : "BLOCKED"}
          </strong>
        </div>
      </div>
    );
  })()}

          {/* ---------------------------------------------
              RECOVERY TRACE
              --------------------------------------------- */}
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
                {demo.outcomes.length}
                charge attempts
              </span>
            </div>

            <div className="demo-events">
              {demo.auditTrail.map(
                (
                  entry,
                  index,
                ) => {
                  const outcome =
                    entry.outcome;

                  const blocked =
                    !entry.guardrail
                      .allowed;

                  const success =
                    outcome?.succeeded ===
                    true;

                  const reconcile =
                    entry.decision
                      .intervention ===
                    "RECONCILE_THEN_DECIDE";

                  return (
                    <div
                      className={[
                        "demo-event",
                        blocked
                          ? "blocked"
                          : success
                            ? "success"
                            : reconcile
                              ? "reconcile"
                              : index ===
                                  demo
                                    .auditTrail
                                    .length -
                                    1
                                ? "active"
                                : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      key={`${entry.paymentId}-${index}`}
                    >
                      <span className="demo-event-number">
                        {String(
                          index + 1,
                        ).padStart(2, "0")}
                      </span>

                      <div className="demo-event-main">
                        <div className="demo-event-heading">
                          <span className="demo-event-type">
                            {formatIntervention(
                              entry
                                .decision
                                .intervention,
                            )}
                          </span>

                          {entry.decision
                            .source ===
                            "fallback" && (
                            <span className="demo-source-badge">
                              FALLBACK
                            </span>
                          )}
                        </div>

                        <strong>
                          {blocked
                            ? "Guardrail blocked"
                            : success
                              ? "Payment recovered"
                              : reconcile
                                ? "Reconciliation required"
                                : outcome
                                  ? formatOutcome(
                                      outcome,
                                    )
                                  : "Decision accepted"}
                        </strong>

                        <p>
                          {describeEvent(
                            entry,
                            outcome,
                          )}
                        </p>

                        <span className="demo-event-technical">
                          {
                            entry.decision
                              .intervention
                          }
                        </span>
                      </div>

                      <span
                        className={[
                          "demo-event-state",
                          blocked
                            ? "block"
                            : success
                              ? "success"
                              : reconcile
                                ? "reconcile"
                                : "pass",
                        ].join(" ")}
                      >
                        {blocked
                          ? "BLOCK"
                          : success
                            ? "RECOVERED"
                            : reconcile
                              ? "RECONCILE"
                              : "PASS"}
                      </span>
                    </div>
                  );
                },
              )}
            </div>
          </div>

          {/* ---------------------------------------------
              FINAL RESULT
              --------------------------------------------- */}
          <div className="demo-result">
            <div className="demo-final-state">
              <span className="field-label">
                FINAL STATE
              </span>

              <strong>
                {formatStopReason(
                  demo.stopReason,
                )}
              </strong>

              <span className="demo-technical-code">
                {demo.stopReason}
              </span>
            </div>

            <div>
              <span className="field-label">
                RECOVERED
              </span>

              <strong className="demo-result-money">
                {formatPaise(
                  demo.outcomes.reduce(
                    (
                      total,
                      outcome,
                    ) =>
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