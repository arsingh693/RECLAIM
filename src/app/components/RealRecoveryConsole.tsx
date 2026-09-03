"use client";

import { FormEvent, useState } from "react";

interface RecoveryLink {
  readonly supported: boolean;
  readonly url: string | null;
  readonly gatewayReference: string | null;
  readonly reason: string | null;
}

interface RecoveryResult {
  readonly paymentId: string;
  readonly status: string;
  readonly declineCode: string;
  readonly candidates: readonly string[];
  readonly intervention: string | null;
  readonly decisionSource: string;
  readonly provider: string;
  readonly reasoning: string;
  readonly confidence: number;
  readonly scheduledFor: string | null;
  readonly switchToMethod: string | null;
  readonly splitAmountPaise: number | null;
  readonly guardrail: boolean;
  readonly blockedBy: readonly string[];
  readonly execution:
    | "not_executed"
    | "customer_action_required"
    | string;
  readonly recoveryLink:
    | RecoveryLink
    | null;
}

function formatINR(
  amountPaise: number | null,
) {
  if (amountPaise === null) {
    return "—";
  }

  return new Intl.NumberFormat(
    "en-IN",
    {
      style: "currency",
      currency: "INR",
    },
  ).format(amountPaise / 100);
}

export default function RealRecoveryConsole() {
  const [paymentId, setPaymentId] =
    useState("");
  const [result, setResult] =
    useState<RecoveryResult | null>(null);
  const [loading, setLoading] =
    useState(false);
  const [error, setError] =
    useState<string | null>(null);

  async function evaluateRecovery(
    event: FormEvent,
  ) {
    event.preventDefault();

    if (!paymentId.trim()) {
      setError(
        "Enter a Razorpay payment ID.",
      );
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        "/api/razorpay/recovery",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            paymentId:
              paymentId.trim(),
            createRecoveryLink: false,
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
      setResult(null);
      setError(
        err instanceof Error
          ? err.message
          : "Recovery evaluation failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="real-recovery-console">
      <div className="real-recovery-console__header">
        <div>
          <span className="eyebrow">
            REAL RAZORPAY TEST MODE
          </span>

          <h2>
            Recovery Operations Console
          </h2>

          <p>
            Inspect a real failed Razorpay
            payment and run the RECLAIM
            recovery decision boundary
            without initiating a new charge.
          </p>
        </div>
      </div>

      <form
        className="real-recovery-console__form"
        onSubmit={evaluateRecovery}
      >
        <label>
          Razorpay payment ID
          <input
            value={paymentId}
            onChange={(event) =>
              setPaymentId(
                event.target.value,
              )
            }
            placeholder="pay_..."
            spellCheck={false}
            autoComplete="off"
          />
        </label>

        <button
          type="submit"
          disabled={loading}
        >
          {loading
            ? "Evaluating..."
            : "Evaluate recovery"}
        </button>
      </form>

      {error ? (
        <div className="real-recovery-console__error">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="real-recovery-console__result">
          <div className="real-recovery-console__topline">
            <div>
              <span className="eyebrow">
                PAYMENT
              </span>

              <h3>
                {result.paymentId}
              </h3>
            </div>

            <div
              className={
                result.guardrail
                  ? "status-badge status-badge--allowed"
                  : "status-badge status-badge--blocked"
              }
            >
              {result.guardrail
                ? "GUARDRAIL ALLOWED"
                : "GUARDRAIL BLOCKED"}
            </div>
          </div>

          <div className="real-recovery-console__metrics">
            <div>
              <span>Status</span>
              <strong>
                {result.status}
              </strong>
            </div>

            <div>
              <span>Failure</span>
              <strong>
                {result.declineCode}
              </strong>
            </div>

            <div>
              <span>Intervention</span>
              <strong>
                {result.intervention ??
                  "None"}
              </strong>
            </div>

            <div>
              <span>Decision source</span>
              <strong>
                {result.decisionSource}
              </strong>
            </div>

            <div>
              <span>Provider</span>
              <strong>
                {result.provider}
              </strong>
            </div>

            <div>
              <span>Execution</span>
              <strong>
                {result.execution}
              </strong>
            </div>
          </div>

          <div className="real-recovery-console__reasoning">
            <span className="eyebrow">
              DECISION REASONING
            </span>

            <p>
              {result.reasoning}
            </p>
          </div>

          <div className="real-recovery-console__flow">
            <div>
              <span>01</span>
              <strong>
                Razorpay
              </strong>
              <small>
                Authoritative payment state
              </small>
            </div>

            <div>
              <span>02</span>
              <strong>
                Taxonomy
              </strong>
              <small>
                Failure classification
              </small>
            </div>

            <div>
              <span>03</span>
              <strong>
                Policy
              </strong>
              <small>
                Closed candidate set
              </small>
            </div>

            <div>
              <span>04</span>
              <strong>
                {result.provider}
              </strong>
              <small>
                Bounded recommendation
              </small>
            </div>

            <div>
              <span>05</span>
              <strong>
                Guardrails
              </strong>
              <small>
                Deterministic authorization
              </small>
            </div>

            <div>
              <span>06</span>
              <strong>
                Audit
              </strong>
              <small>
                Decision recorded
              </small>
            </div>
          </div>

          <div className="real-recovery-console__details">
            <div>
              <span>
                Scheduled for
              </span>
              <strong>
                {result.scheduledFor ??
                  "—"}
              </strong>
            </div>

            <div>
              <span>
                Switch method
              </span>
              <strong>
                {result.switchToMethod ??
                  "—"}
              </strong>
            </div>

            <div>
              <span>
                Split amount
              </span>
              <strong>
                {formatINR(
                  result.splitAmountPaise,
                )}
              </strong>
            </div>

            <div>
              <span>
                Blocked by
              </span>
              <strong>
                {result.blockedBy.length
                  ? result.blockedBy.join(
                      ", ",
                    )
                  : "None"}
              </strong>
            </div>
          </div>

          {result.recoveryLink?.url ? (
            <a
              href={
                result.recoveryLink.url
              }
              target="_blank"
              rel="noreferrer"
              className="real-recovery-console__recovery-link"
            >
              Open recovery link
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}