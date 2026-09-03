"use client";

import { FormEvent, useState } from "react";

interface RecoveryResponse {
  readonly paymentId: string;
  readonly status: string;
  readonly declineCode: string;
  readonly candidates: readonly string[];
  readonly intervention: string | null;
  readonly decisionSource: string;
  readonly reasoning: string;
  readonly confidence: number;
  readonly scheduledFor: string | null;
  readonly switchToMethod: string | null;
  readonly splitAmountPaise: number | null;
  readonly guardrail: boolean;
  readonly blockedBy: readonly string[];
  readonly execution: string;
  readonly recoveryLink:
    | {
        readonly supported: boolean;
        readonly url: string | null;
        readonly gatewayReference: string | null;
        readonly reason: string | null;
      }
    | null;
}

const scenarios = [
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
    label: "Mandate limit",
  },
] as const;

type RecoveryScenario =
  (typeof scenarios)[number]["id"];

export default function RecoveryDemo() {
  const [scenario, setScenario] =
  useState<RecoveryScenario>(
    scenarios[0].id,
  );
  const [result, setResult] =
    useState<RecoveryResponse | null>(null);
  const [loading, setLoading] =
    useState(false);
  const [error, setError] =
    useState<string | null>(null);

  async function runDemo(
    event?: FormEvent,
  ) {
    event?.preventDefault();

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
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
        response.headers.get(
          "content-type",
        ) ?? "";

      const payload =
        contentType.includes(
          "application/json",
        )
          ? await response.json()
          : {
              error: await response.text(),
            };

      if (!response.ok) {
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : "Recovery evaluation failed.",
        );
      }

      setResult(payload);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Recovery evaluation failed.",
      );
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="recovery-demo">
      <div className="recovery-demo__header">
        <div>
          <span className="eyebrow">
            DECISION SIMULATOR
          </span>
          <h3>
            Test the recovery boundary
          </h3>
          <p>
            RECLAIM evaluates each failure
            against deterministic policy,
            bounded AI selection, and
            fail-closed guardrails.
          </p>
        </div>
      </div>

      <form
        className="recovery-demo__controls"
        onSubmit={runDemo}
      >
        <label>
          Failure scenario
          <select
            value={scenario}
            onChange={(event) =>
              setScenario(
                event.target.value as RecoveryScenario,
              )
            }
          >
            {scenarios.map((item) => (
              <option
                key={item.id}
                value={item.id}
              >
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          disabled={loading}
        >
          {loading
            ? "Evaluating..."
            : "Run recovery"}
        </button>
      </form>

      {error ? (
        <div className="recovery-demo__error">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="recovery-demo__result">
          <div className="recovery-demo__decision">
            <div>
              <span className="eyebrow">
                DECISION CENTER
              </span>

              <h4>
                {result.intervention ??
                  "No intervention"}
              </h4>

              <p>
                {result.reasoning}
              </p>
            </div>

            <div
              className={
                result.guardrail
                  ? "status-badge status-badge--allowed"
                  : "status-badge status-badge--blocked"
              }
            >
              {result.guardrail
                ? "AUTHORIZED"
                : "BLOCKED"}
            </div>
          </div>

          <div className="recovery-demo__grid">
            <div className="recovery-demo__card">
              <span>Policy</span>
              <strong>
                {result.candidates.join(
                  ", ",
                )}
              </strong>
            </div>

            <div className="recovery-demo__card">
              <span>Decision source</span>
              <strong>
                {result.decisionSource}
              </strong>
            </div>

            <div className="recovery-demo__card">
              <span>Decision source</span>
              <strong>
                {result.decisionSource}
              </strong>
            </div>

            <div className="recovery-demo__card">
              <span>Confidence</span>
              <strong>
                {(
                  result.confidence * 100
                ).toFixed(0)}
                %
              </strong>
            </div>

            <div className="recovery-demo__card">
              <span>Guardrails</span>
              <strong>
                {result.guardrail
                  ? "Allowed"
                  : "Blocked"}
              </strong>
            </div>

            <div className="recovery-demo__card">
              <span>Execution</span>
              <strong>
                {result.execution}
              </strong>
            </div>
          </div>

          <div className="recovery-demo__trace">
            <div className="recovery-demo__trace-step">
              <span>01</span>
              <strong>Policy</strong>
              <small>
                Candidate set generated
              </small>
            </div>

            <div className="recovery-demo__trace-step">
              <span>02</span>
              <strong>
                {result.decisionSource}
              </strong>
              <small>
                Policy-bounded decision
              </small>
            </div>

            <div className="recovery-demo__trace-step">
              <span>03</span>
              <strong>Guardrails</strong>
              <small>
                Final authorization
              </small>
            </div>

            <div className="recovery-demo__trace-step">
              <span>04</span>
              <strong>
                {result.execution}
              </strong>
              <small>
                Execution boundary
              </small>
            </div>
          </div>

          {result.recoveryLink?.url ? (
            <a
              href={result.recoveryLink.url}
              target="_blank"
              rel="noreferrer"
              className="recovery-demo__link"
            >
              Open recovery link
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
