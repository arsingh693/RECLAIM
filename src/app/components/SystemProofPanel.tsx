"use client";

import { BENCHMARK } from "../data/benchmark";

import {
  useEffect,
  useState,
} from "react";

interface HealthResponse {
  readonly ok?: boolean;
  readonly provider?: string;
  readonly mode?: string;
  readonly authenticated?: boolean;
  readonly paymentCount?: number;
  readonly error?: string;
}

interface AuditResponse {
  readonly provider?: string;
  readonly events?: unknown[];
}

interface ProofStatus {
  readonly gateway:
    | "checking"
    | "online"
    | "offline";

  readonly audit:
    | "checking"
    | "online"
    | "offline";
}

function stateLabel(
  state: ProofStatus["gateway"],
): string {
  switch (state) {
    case "online":
      return "ONLINE";

    case "offline":
      return "OFFLINE";

    default:
      return "CHECKING";
  }
}

function formatINR(
  paise: number,
): string {
  return `₹${(
    paise / 100
  ).toLocaleString(
    "en-IN",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  )}`;
}

export default function SystemProofPanel() {
  const [
    status,
    setStatus,
  ] = useState<ProofStatus>({
    gateway: "checking",
    audit: "checking",
  });

  const [
    paymentCount,
    setPaymentCount,
  ] = useState<number | null>(
    null,
  );

  const [
    auditCount,
    setAuditCount,
  ] = useState<number | null>(
    null,
  );

  const [
    checkedAt,
    setCheckedAt,
  ] = useState<string | null>(
    null,
  );

  useEffect(() => {
    let active = true;

    async function checkSystem() {
      try {
        const [
          healthResponse,
          auditResponse,
        ] = await Promise.all([
          fetch(
            "/api/razorpay/health",
            {
              cache: "no-store",
            },
          ),
          fetch(
            "/api/razorpay/audit",
            {
              cache: "no-store",
            },
          ),
        ]);

        let health:
          | HealthResponse
          | null = null;

        let audit:
          | AuditResponse
          | null = null;

        if (
          healthResponse.ok &&
          (
            healthResponse.headers
              .get(
                "content-type",
              ) ?? ""
          ).includes(
            "application/json",
          )
        ) {
          health =
            (await healthResponse.json()) as HealthResponse;
        }

        if (
          auditResponse.ok &&
          (
            auditResponse.headers
              .get(
                "content-type",
              ) ?? ""
          ).includes(
            "application/json",
          )
        ) {
          audit =
            (await auditResponse.json()) as AuditResponse;
        }

        if (!active) {
          return;
        }

        setStatus({
          gateway:
            healthResponse.ok &&
            health?.ok === true
              ? "online"
              : "offline",

          audit:
            auditResponse.ok
              ? "online"
              : "offline",
        });

        setPaymentCount(
          typeof health?.paymentCount ===
            "number"
            ? health.paymentCount
            : null,
        );

        setAuditCount(
          Array.isArray(
            audit?.events,
          )
            ? audit.events.length
            : null,
        );

        setCheckedAt(
          new Date().toISOString(),
        );
      } catch {
        if (!active) {
          return;
        }

        setStatus({
          gateway: "offline",
          audit: "offline",
        });

        setCheckedAt(
          new Date().toISOString(),
        );
      }
    }

    void checkSystem();

    const interval =
      window.setInterval(
        () => {
          void checkSystem();
        },
        5000,
      );

    return () => {
      active = false;
      window.clearInterval(
        interval,
      );
    };
  }, []);

  return (
    <section className="system-proof-panel">
      <div className="section-kicker">
        SYSTEM PROOF
      </div>

      <div className="system-proof-panel__header">
        <div>
          <h2>
            Built to be inspected.
          </h2>

          <p>
            The important claims are either
            live system checks or deterministic
            benchmark evidence.
          </p>
        </div>

        <div className="system-proof-panel__timestamp">
          {checkedAt
            ? `Checked ${new Date(
                checkedAt,
              ).toLocaleTimeString(
                "en-IN",
              )}`
            : "Checking system..."}
        </div>
      </div>

      <div className="system-proof-panel__grid">
        <article className="system-proof-card">
          <div className="system-proof-card__top">
            <span>
              RAZORPAY
            </span>

            <span
              className={`system-proof-status system-proof-status--${status.gateway}`}
            >
              <i aria-hidden="true" />

              {stateLabel(
                status.gateway,
              )}
            </span>
          </div>

          <strong>
            Real Test Mode gateway
          </strong>

          <p>
            Orders, Checkout, payment
            verification, and payment-state
            lookup are connected to Razorpay.
          </p>

          {paymentCount !== null ? (
            <small>
              Payments observed:{" "}
              {paymentCount}
            </small>
          ) : null}
        </article>

        <article className="system-proof-card">
          <div className="system-proof-card__top">
            <span>
              WEBHOOK
            </span>

            <span className="system-proof-badge">
              VERIFIED
            </span>
          </div>

          <strong>
            Signed event ingestion
          </strong>

          <p>
            Signature verification and
            event-id protection sit before
            recovery evaluation.
          </p>

          <small>
            payment.failed is the recovery
            entry point.
          </small>
        </article>

        <article className="system-proof-card">
          <div className="system-proof-card__top">
            <span>
              DECISION ENGINE
            </span>

            <span className="system-proof-badge">
              BOUNDED
            </span>
          </div>

          <strong>
            Policy → AI → guardrails
          </strong>

          <p>
            AI selects within a policy-approved
            action space. Deterministic
            guardrails retain final authority.
          </p>

          <small>
            AI cannot widen the action space.
          </small>
        </article>

        <article className="system-proof-card">
          <div className="system-proof-card__top">
            <span>
              SAFETY
            </span>

            <span className="system-proof-badge">
              FAIL-CLOSED
            </span>
          </div>

          <strong>
            Money movement is bounded
          </strong>

          <p>
            Risk blocks, disputes, attempt
            ceilings, mandate limits, and
            ambiguous gateway states are
            handled before execution.
          </p>

          <small>
            Unknown gateway outcomes require
            reconciliation.
          </small>
        </article>

        <article className="system-proof-card">
          <div className="system-proof-card__top">
            <span>
              AUDIT
            </span>

            <span
              className={`system-proof-status system-proof-status--${status.audit}`}
            >
              <i aria-hidden="true" />

              {stateLabel(
                status.audit,
              )}
            </span>
          </div>

          <strong>
            Inspectable recovery trail
          </strong>

          <p>
            Recovery evaluations, guardrail
            outcomes, and recovery-link events
            are exposed through the recovery
            ledger.
          </p>

          {auditCount !== null ? (
            <small>
              Events in current process:{" "}
              {auditCount}
            </small>
          ) : null}
        </article>

        <article className="system-proof-card system-proof-card--benchmark">
          <div className="system-proof-card__top">
            <span>
              BENCHMARK
            </span>

            <span className="system-proof-badge">
              VERIFIED RUN
            </span>
          </div>

          <strong>
            More recovery. Fewer attempts.
          </strong>

          <div className="system-proof-metrics">
            <div>
              <span>
                RECOVERY RATE
              </span>

              <b>
                {(
                  BENCHMARK.reclaim
                    .recoveryRate *
                  100
                ).toFixed(2)}
                %
              </b>
            </div>

            <div>
              <span>
                RECOVERED
              </span>

              <b>
                {formatINR(
                  BENCHMARK.reclaim
                    .recoveredPaise,
                )}
              </b>
            </div>

            <div>
              <span>
                ATTEMPTS
              </span>

              <b>
                {BENCHMARK.reclaim.attempts}
              </b>
            </div>
          </div>

          <div className="system-proof-metric-highlight">
            <span>
              RELATIVE IMPROVEMENT
            </span>

            <b>
              +
              {BENCHMARK.improvement.recoveryRatePercent.toFixed(
                2,
              )}
              %
            </b>
          </div>

          <small>
            Benchmark run · deterministic seeded population.
          </small>
        </article>
      </div>

      <div className="system-proof-panel__boundary">
        <div>
          <span>
            REAL
          </span>

          <strong>
            Razorpay Test Mode
          </strong>
        </div>

        <div className="system-proof-panel__arrow">
          →
        </div>

        <div>
          <span>
            RECLAIM
          </span>

          <strong>
            Policy + AI + guardrails
          </strong>
        </div>

        <div className="system-proof-panel__arrow">
          →
        </div>

        <div>
          <span>
            PROOF
          </span>

          <strong>
            Audit + benchmark
          </strong>
        </div>
      </div>
    </section>
  );
}