import {
  BENCHMARK,
  BENCHMARK_METRICS,
  BENCHMARK_PAYMENT_COUNT,
  BENCHMARK_SEED,
} from "./data/benchmark";

import SystemProofPanel from "./components/SystemProofPanel";
import RealRecoveryConsole from "./components/RealRecoveryConsole";
import RecoveryDemo from "./components/RecoveryDemo";
import RazorpayCheckout from "./components/RazorpayCheckout";
import AuditLedger from "./components/AuditLedger";

const safetyChecks = [
  "Candidate actions contained by taxonomy",
  "AI cannot widen the permitted action space",
  "Invalid AI confidence rejected",
  "Non-charge decisions cannot reach gateway",
  "Open disputes block money movement",
  "Risk blocks cannot bypass another rail",
  "Attempt ceilings cannot be exceeded",
  "Gateway timeouts require reconciliation",
  "Mandate ceilings protect authorization boundaries",
];

const interventions = [
  ["RETRY_SCHEDULED", "69", "8 recovered"],
  ["ESCALATE_HUMAN", "40", "18 escalations"],
  ["REQUEST_INSTRUMENT_UPDATE", "19", "0 charge attempts"],
  ["RETRY_ALTERNATE_RAIL", "13", "2 recovered"],
  ["RETRY_NOW", "12", "4 recovered"],
  ["RETRY_SPLIT_AMOUNT", "10", "1 recovered"],
];

export default function Home() {
  const razorpayKeyId =
    process.env.RAZORPAY_KEY_ID ?? "";

  return (
    <main
      className="site"
      data-razorpay-key={razorpayKeyId}
    >
      <nav className="nav">
        <div className="nav-inner">
          <a
            className="logo"
            href="#overview"
            aria-label="RECLAIM — Autonomous Payment Recovery"
          >
            <span className="logo-symbol">
              <img
                src="/reclaim-logo.png"
                alt="RECLAIM"
              />
            </span>

            <span className="logo-copy">
              <strong>RECLAIM</strong>
              <small>
                Autonomous Payment Recovery
              </small>
            </span>
          </a>

          <div
            className="nav-links"
            aria-label="Primary navigation"
          >
            <a href="#overview">
              Overview
            </a>

            <a href="#recovery">
              Engine
            </a>

            <a href="#benchmark">
              Benchmark
            </a>

            <a href="#safety">
              Safety
            </a>

            <a href="#proof">
              Proof
            </a>
          </div>

          <div className="nav-actions">
            <span className="mode">
              <span className="mode-dot" />
              DEMO MODE
            </span>

            <a
              className="button button-primary"
              href="#recovery"
            >
              Run demo <span>→</span>
            </a>
          </div>
        </div>
      </nav>

      <section
        className="hero"
        id="overview"
      >
        <div className="hero-inner">
          <div className="hero-copy">
            <div className="eyebrow">
              PAYMENT RECOVERY ENGINE
            </div>

            <h1>
              <span className="hero-line hero-line-primary">
                Recover more payments.
              </span>

              <span className="hero-line hero-line-accent">
                Keep the boundary deterministic.
              </span>
            </h1>

            <p>
              RECLAIM uses AI to recommend
              recovery actions inside a closed,
              deterministic action space. Policy
              and guardrails decide what is
              actually allowed to execute.
            </p>

            <div className="hero-actions">
              <a
                className="button button-primary"
                href="#recovery"
              >
                See the engine <span>→</span>
              </a>

              <a
                className="button button-link"
                href="#benchmark"
              >
                View benchmark
              </a>
            </div>

            <div
              className="hero-note"
              aria-label="RECLAIM authority flow"
            >
              <span>AI</span>
              recommends
              <i>→</i>
              <span>POLICY</span>
              constrains
              <i>→</i>
              <span>GUARDRAILS</span>
              decide
            </div>
          </div>

          <div
            className="hero-product"
            aria-label="RECLAIM recovery preview"
          >
            <div className="product-window">
              <div className="window-header">
                <div>
                  <span className="window-kicker">
                    LIVE RECOVERY
                  </span>

                  <strong>
                    Payment decision
                  </strong>
                </div>

                <span className="window-status">
                  <span />
                  ACTIVE
                </span>
              </div>

              <div className="payment-summary">
                <div>
                  <span className="field-label">
                    PAYMENT
                  </span>

                  <strong>
                    pay_sim_0042
                  </strong>
                </div>

                <div className="payment-amount">
                  <span className="field-label">
                    AMOUNT
                  </span>

                  <strong>
                    ₹4,990.00
                  </strong>
                </div>
              </div>

              <div className="failure-banner">
                <div>
                  <span className="field-label">
                    DECLINE
                  </span>

                  <strong>
                    INSUFFICIENT_FUNDS
                  </strong>
                </div>

                <span className="failure-tag">
                  FUNDING
                </span>
              </div>

              <div className="customer-row">
                <div>
                  <span className="field-label">
                    CUSTOMER SIGNALS
                  </span>

                  <strong>
                    14 successful charges
                  </strong>
                </div>

                <span className="customer-signal">
                  Strong payer history
                </span>
              </div>

              <div className="decision-flow">
                <div className="flow-step">
                  <span className="flow-index">
                    01
                  </span>

                  <div>
                    <small>
                      POLICY
                    </small>

                    <strong>
                      Closed candidate set
                    </strong>
                  </div>

                  <span className="flow-state">
                    READY
                  </span>
                </div>

                <div className="flow-step highlighted">
                  <span className="flow-index">
                    02
                  </span>

                  <div>
                    <small>
                      AI RECOMMENDATION
                    </small>

                    <strong>
                      RETRY_SCHEDULED
                    </strong>
                  </div>

                  <span className="flow-confidence">
                    82%
                  </span>
                </div>

                <div className="flow-step">
                  <span className="flow-index">
                    03
                  </span>

                  <div>
                    <small>
                      GUARDRAIL
                    </small>

                    <strong>
                      Permitted
                    </strong>
                  </div>

                  <span
                    className="allowed"
                    aria-label="Allowed"
                  >
                    ✓
                  </span>
                </div>
              </div>

              <div className="window-footer">
                <span>
                  Deterministic execution boundary
                </span>

                <button type="button">
                  Execute recovery →
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        className="trust-strip"
        aria-label="Capabilities"
      >
        <div className="trust-inner">
          <span>
            BUILT FOR PAYMENT OPERATIONS
          </span>

          <span>
            DETERMINISTIC POLICY
          </span>

          <span>
            BOUNDED AI
          </span>

          <span>
            AUDITABLE EXECUTION
          </span>

          <span>
            RAZORPAY-READY GATEWAY ADAPTER
          </span>
        </div>
      </section>

      <section
        className="section recovery-section recovery-featured"
        id="recovery"
      >
        <div className="section-inner">
          <div className="recovery-feature-header">
            <div className="recovery-feature-copy">
              <div className="eyebrow">
                LIVE RECOVERY ENGINE
              </div>

              <h2>
                See RECLAIM
                <br />
                make the decision.
              </h2>

              <p>
                This is the actual recovery
                engine. Select a payment failure,
                run the system, and inspect every
                decision from policy through
                execution.
              </p>
            </div>

            <div className="recovery-feature-meta">
              <div className="engine-status">
                <span className="mode-dot" />

                <strong>
                  ENGINE ONLINE
                </strong>
              </div>

              <div className="engine-meta-copy">
                <span>
                  DETERMINISTIC
                </span>

                <span>•</span>

                <span>
                  AUDITABLE
                </span>

                <span>•</span>

                <span>
                  LIVE DEMO
                </span>
              </div>
            </div>
          </div>

          <div className="engine-intro-bar">
            <div>
              <span className="field-label">
                INTERACTIVE DEMONSTRATION
              </span>

              <strong>
                Run a real recovery scenario
              </strong>
            </div>

            <div
              className="engine-flow-label"
              aria-hidden="true"
            >
              <span>
                POLICY
              </span>

              <i>→</i>

              <span>
                AI
              </span>

              <i>→</i>

              <span>
                GUARDRAILS
              </span>

              <i>→</i>

              <span>
                GATEWAY
              </span>
            </div>
          </div>

          {/* Single RecoveryDemo instance */}
          <div className="live-engine">
            <RecoveryDemo />
          </div>

          <div
            style={{
              marginTop: 20,
              padding: "20px 24px",
              border:
                "1px solid var(--line-strong)",
              borderRadius:
                "var(--radius-md)",
              background: "#fff",
            }}
          >
            <div>
              <span className="field-label">
                REAL RAZORPAY TEST
              </span>

              <strong
                style={{
                  display: "block",
                  marginTop: 6,
                }}
              >
                Execute a real ₹100 Test Mode
                payment
              </strong>
            </div>

            <div
              style={{
                marginTop: 16,
              }}
            >
              <RazorpayCheckout
                amountPaise={10000}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="section operations-proof-section">
        <div className="section-inner">
          <RealRecoveryConsole />

          <AuditLedger />

          <SystemProofPanel />
        </div>
      </section>

      <section
        className="section performance-section"
        id="benchmark"
      >
        <div className="section-inner">
          <div className="section-intro">
            <div>
              <div className="eyebrow">
                BENCHMARK
              </div>

              <h2>
                More recovery.
                <br />
                Fewer attempts.
              </h2>
            </div>

            <div className="section-side-copy">
              Same seeded payment population.
              <br />
              Two strategies. One measured outcome.
            </div>
          </div>

          <div className="performance-panel">
            <div className="performance-header">
              <div>
                <strong>
                  {BENCHMARK_SEED}
                </strong>

                <span>
                  {BENCHMARK_PAYMENT_COUNT}{" "}
                  payments · deterministic
                  seed
                </span>
              </div>

              <span className="verified">
                VERIFIED RUN
              </span>
            </div>

            <div className="performance-table">
              <div className="performance-row performance-labels">
                <span>
                  METRIC
                </span>

                <span>
                  BASELINE
                </span>

                <span>
                  RECLAIM
                </span>

                <span>
                  CHANGE
                </span>
              </div>

              {BENCHMARK_METRICS.map(
                (row) => (
                  <div
                    className="performance-row"
                    key={row.label}
                  >
                    <strong>
                      {row.label}
                    </strong>

                    <span>
                      {row.baseline}
                    </span>

                    <span className="reclaim-value">
                      {row.reclaim}
                    </span>

                    <span className="change">
                      {row.improvement}
                    </span>
                  </div>
                ),
              )}
            </div>

            <div className="performance-callout">
              <div className="callout-number">
                +
                {BENCHMARK.improvement.recoveryRatePercent.toFixed(
                  2,
                )}
                %
              </div>

              <div>
                <strong>
                  relative recovery improvement
                </strong>

                <p>
  RECLAIM recovered{" "}
  {`₹${(BENCHMARK.improvement.recoveredDifferencePaise / 100).toLocaleString(
    "en-IN",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  )}`}{" "}
  more while making{" "}
  {Math.abs(BENCHMARK.improvement.attemptDifference)} fewer
  charge attempts than the fixed retry baseline.
</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        className="safety-section"
        id="safety"
      >
        <div className="section-inner">
          <div className="section-intro">
            <div>
              <div className="eyebrow">
                SAFETY ARCHITECTURE
              </div>

              <h2>
                The model recommends.
                <br />
                The system decides.
              </h2>
            </div>

            <div className="section-side-copy light">
              AI operates inside the decision
              boundary.
              <br />
              It never owns the authority to
              execute.
            </div>
          </div>

          <div className="safety-grid">
            <div className="safety-list">
              {safetyChecks.map(
                (check, index) => (
                  <div
                    className="safety-row"
                    key={check}
                  >
                    <span>
                      {String(
                        index + 1,
                      ).padStart(
                        2,
                        "0",
                      )}
                    </span>

                    <strong>
                      {check}
                    </strong>

                    <b>
                      PASS
                    </b>
                  </div>
                ),
              )}
            </div>

            <div className="authority-stack">
              <div className="authority-title">
                AUTHORITY BOUNDARY
              </div>

              <div className="authority-box">
                <span>AI</span>
                <strong>
                  RECOMMENDS
                </strong>
              </div>

              <div className="authority-arrow">
                ↓
              </div>

              <div className="authority-box">
                <span>POLICY</span>
                <strong>
                  CONSTRAINS
                </strong>
              </div>

              <div className="authority-arrow">
                ↓
              </div>

              <div className="authority-box primary">
                <span>
                  GUARDRAILS
                </span>

                <strong>
                  DECIDE
                </strong>
              </div>

              <div className="authority-arrow">
                ↓
              </div>

              <div className="authority-box">
                <span>
                  GATEWAY
                </span>

                <strong>
                  EXECUTES
                </strong>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section policy-section">
        <div className="section-inner">
          <div className="section-intro">
            <div>
              <div className="eyebrow">
                RECOVERY POLICY
              </div>

              <h2>
                Closed action space.
              </h2>
            </div>

            <div className="section-side-copy">
              The model chooses from permitted
              recovery actions. It never invents
              the strategy.
            </div>
          </div>

          <div className="policy-table">
            <div className="policy-row policy-head">
              <span>
                INTERVENTION
              </span>

              <span>
                DECISIONS
              </span>

              <span>
                OBSERVED RESULT
              </span>
            </div>

            {interventions.map(
              ([
                name,
                count,
                result,
              ]) => (
                <div
                  className="policy-row"
                  key={name}
                >
                  <span className="policy-name">
                    {name}
                  </span>

                  <span>
                    {count}
                  </span>

                  <span>
                    {result}
                  </span>
                </div>
              ),
            )}
          </div>
        </div>
      </section>

      <section className="incident-section">
        <div className="section-inner">
          <div className="section-intro">
            <div>
              <div className="eyebrow">
                ENGINEERING LOG
              </div>

              <h2>
                What broke at 2 AM.
              </h2>
            </div>

            <div className="section-side-copy light">
              Measure it. Trace it. Fix it.
              Re-run it.
            </div>
          </div>

          <div className="incident-log">
            <div className="incident-row failure">
              <span>
                01
              </span>

              <div className="incident-time">
                02:14
              </div>

              <div>
                <strong>
                  Recovery benchmark falls to
                  1.95%
                </strong>

                <p>
                  RECLAIM was recovering
                  dramatically less than the
                  fixed retry baseline.
                </p>
              </div>
            </div>

            <div className="incident-row">
              <span>
                02
              </span>

              <div className="incident-time">
                02:27
              </div>

              <div>
                <strong>
                  Trace reveals policy mismatch
                </strong>

                <p>
                  Candidate actions were not
                  completely aligned with the
                  hard decline taxonomy.
                </p>
              </div>
            </div>

            <div className="incident-row">
              <span>
                03
              </span>

              <div className="incident-time">
                03:06
              </div>

              <div>
                <strong>
                  Recovery lifecycle corrected
                </strong>

                <p>
                  The benchmark was moved to
                  the multi-step recovery runner
                  and candidate containment was
                  enforced.
                </p>
              </div>
            </div>

            <div className="incident-row success-row">
              <span>
                04
              </span>

              <div className="incident-time">
                03:32
              </div>

              <div>
                <strong>
  Recovery reaches{" "}
  {(BENCHMARK.reclaim.recoveryRate * 100).toFixed(2)}%
</strong>
<p>
  The corrected system recovered{" "}
  {`₹${(BENCHMARK.reclaim.recoveredPaise / 100).toLocaleString(
    "en-IN",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  )}`}{" "}
  with {BENCHMARK.reclaim.attempts} charge attempts.
</p>
              </div>
            </div>

            <div className="incident-row success-row">
              <span>
                05
              </span>

              <div className="incident-time">
                03:40
              </div>

              <div>
                <strong>
                  Adversarial safety proof passes
                </strong>

                <p>
                  Taxonomy, AI boundary,
                  gateway isolation, timeout,
                  attempt-ceiling, risk and
                  mandate tests all pass.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        className="section proof-section"
        id="proof"
      >
        <div className="section-inner">
          <div className="proof-banner">
            <div className="proof-copy">
              <div className="eyebrow">
                DETERMINISTIC SAFETY PROOF
              </div>

              <h2>
                100 payments.
                <br />
                177 decisions.
                <br />
                92 attempts.
              </h2>

              <p>
                A separate deterministic proof run recovered ₹37,985.50 with
  zero AI fallbacks. Adversarial safety assertions passed.
              </p>
            </div>

            <div className="proof-stats">
              <div>
                <strong>
                  15
                </strong>

                <span>
                  Recovered
                </span>
              </div>

              <div>
                <strong>
                  40
                </strong>

                <span>
                  Human escalations
                </span>
              </div>

              <div>
                <strong>
                  12
                </strong>

                <span>
                  Mandate blocks
                </span>
              </div>

              <div>
                <strong>
                  0
                </strong>

                <span>
                  AI fallbacks
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="final-cta">
        <div className="section-inner">
          <div className="cta-inner">
            <div>
              <div className="eyebrow">
                RECLAIM
              </div>

              <h2>
                Recovery that earns the
                <br />
                right to execute.
              </h2>
            </div>

            <div className="cta-actions">
              <a
                className="button button-light"
                href="#recovery"
              >
                Run the demo{" "}
                <span>→</span>
              </a>

              <a
                className="button button-outline-light"
                href="#proof"
              >
                View proof
              </a>
            </div>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="section-inner footer-inner">
          <span className="footer-brand">
            RECLAIM
          </span>

          <span>
            Deterministic recovery · bounded
            autonomy · auditable execution
          </span>
        </div>
      </footer>
    </main>
  );
}