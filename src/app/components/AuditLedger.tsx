"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

interface AuditEvent {
  readonly id: string;
  readonly eventType: string;
  readonly paymentId: string;
  readonly eventId: string | null;
  readonly intervention: string | null;
  readonly status: string;
  readonly details: Record<string, unknown>;
  readonly createdAt: string;
}

interface AuditResponse {
  readonly provider: string;
  readonly events: AuditEvent[];
}

function formatDate(
  value: string,
): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function labelize(
  value: string,
): string {
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) =>
      char.toUpperCase(),
    );
}

function statusLabel(
  value: string,
): string {
  switch (value) {
    case "allowed":
      return "ALLOWED";

    case "blocked":
      return "BLOCKED";

    case "created":
      return "CREATED";

    case "failed":
      return "FAILED";

    case "existing_link_reused":
      return "REUSED";

    default:
      return value.toUpperCase();
  }
}

function eventSummary(
  event: AuditEvent,
): string {
  switch (event.eventType) {
    case "RECOVERY_EVALUATED":
      if (
        event.status ===
        "blocked"
      ) {
        return "Recovery evaluation stopped by deterministic guardrails.";
      }

      if (
        event.status ===
        "existing_link_reused"
      ) {
        return "An existing customer recovery link was reused safely.";
      }

      return "Recovery strategy evaluated against the permitted action set.";

    case "RECOVERY_BLOCKED":
      return "Recovery action was blocked before money movement.";

    case "RECOVERY_LINK_CREATED":
      return "A customer-authorized Razorpay recovery link was created.";

    case "RECOVERY_LINK_FAILED":
      return "Recovery-link creation failed before customer action.";

    default:
      return "Recovery event recorded.";
  }
}

export default function AuditLedger() {
  const [
    events,
    setEvents,
  ] = useState<AuditEvent[]>([]);

  const [
    paymentId,
    setPaymentId,
  ] = useState("");

  const [
    appliedFilter,
    setAppliedFilter,
  ] = useState("");

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    error,
    setError,
  ] = useState<string | null>(
    null,
  );

  const [
    lastUpdated,
    setLastUpdated,
  ] = useState<string | null>(
    null,
  );

  const loadEvents = useCallback(
    async (
      filter = appliedFilter,
      showLoading = true,
    ) => {
      if (showLoading) {
        setLoading(true);
      }

      setError(null);

      try {
        const trimmed =
          filter.trim();

        const query = trimmed
          ? `?paymentId=${encodeURIComponent(
              trimmed,
            )}`
          : "";

        const response =
          await fetch(
            `/api/razorpay/audit${query}`,
            {
              cache: "no-store",
            },
          );

        const contentType =
          response.headers.get(
            "content-type",
          ) ?? "";

        if (
          !contentType.includes(
            "application/json",
          )
        ) {
          throw new Error(
            `Audit API returned HTTP ${response.status}.`,
          );
        }

        const body =
          (await response.json()) as
            | AuditResponse
            | {
                error?: string;
              };

        if (!response.ok) {
          throw new Error(
            "error" in body
              ? body.error ??
                "Could not load audit events."
              : "Could not load audit events.",
          );
        }

        setEvents(
          (body as AuditResponse)
            .events ?? [],
        );

        setLastUpdated(
          new Date().toISOString(),
        );
      } catch (
        loadError
      ) {
        setError(
          loadError instanceof
            Error
            ? loadError.message
            : "Could not load audit events.",
        );
      } finally {
        if (showLoading) {
          setLoading(false);
        }
      }
    },
    [appliedFilter],
  );

  useEffect(() => {
    void loadEvents("", true);

    const interval =
      window.setInterval(() => {
        void loadEvents(
          appliedFilter,
          false,
        );
      }, 3000);

    return () => {
      window.clearInterval(
        interval,
      );
    };
  }, [
    loadEvents,
    appliedFilter,
  ]);

  function applyFilter() {
    setAppliedFilter(
      paymentId.trim(),
    );
  }

  function clearFilter() {
    setPaymentId("");
    setAppliedFilter("");
  }

  return (
    <section className="audit-ledger">
      <div className="section-kicker">
        APPEND-ONLY RECOVERY LEDGER
      </div>

      <div className="audit-ledger__header">
        <div>
          <h2>
            Every recovery decision leaves an inspectable trail.
          </h2>

          <p>
            Inspect the policy decision,
            AI selection, guardrail result,
            and gateway action for each
            recovery evaluation.
          </p>
        </div>

        <div className="audit-ledger__live">
          <span
            className="audit-ledger__live-dot"
            aria-hidden="true"
          />

          <span>
            LIVE
          </span>

          {lastUpdated ? (
            <span>
              {formatDate(
                lastUpdated,
              )}
            </span>
          ) : null}
        </div>
      </div>

      <div className="audit-ledger__toolbar">
        <div className="audit-ledger__filter">
          <input
            value={paymentId}
            onChange={(event) =>
              setPaymentId(
                event.target.value,
              )
            }
            placeholder="Filter by payment ID: pay_..."
            aria-label="Filter audit ledger by payment ID"
            onKeyDown={(event) => {
              if (
                event.key ===
                "Enter"
              ) {
                applyFilter();
              }
            }}
          />

          <button
            type="button"
            onClick={
              applyFilter
            }
          >
            Apply filter
          </button>

          {appliedFilter ? (
            <button
              type="button"
              className="audit-ledger__clear"
              onClick={
                clearFilter
              }
            >
              Clear
            </button>
          ) : null}
        </div>

        <button
          type="button"
          className="audit-ledger__refresh"
          onClick={() =>
            void loadEvents(
              appliedFilter,
              true,
            )
          }
          disabled={loading}
        >
          {loading
            ? "Refreshing..."
            : "Refresh ledger"}
        </button>
      </div>

      {appliedFilter ? (
        <div className="audit-ledger__active-filter">
          Showing events for{" "}
          <strong>
            {appliedFilter}
          </strong>
        </div>
      ) : null}

      {error ? (
        <div className="audit-ledger__error">
          {error}
        </div>
      ) : null}

      {!loading &&
      !error &&
      events.length === 0 ? (
        <div className="audit-ledger__empty">
          <strong>
            No audit events yet.
          </strong>

          <span>
            Run a real recovery evaluation
            or trigger a{" "}
            <code>
              payment.failed
            </code>{" "}
            webhook to populate the
            ledger.
          </span>
        </div>
      ) : null}

      {events.length > 0 ? (
        <>
          <div className="audit-ledger__count">
            {events.length}{" "}
            {events.length === 1
              ? "event"
              : "events"}{" "}
            recorded
          </div>

          <div className="audit-ledger__list">
            {events.map(
              (
                event,
                index,
              ) => (
                <article
                  key={event.id}
                  className={`audit-ledger__event${
                    index === 0
                      ? " audit-ledger__event--latest"
                      : ""
                  }`}
                >
                  <div className="audit-ledger__event-main">
                    <div className="audit-ledger__event-title">
                      <span className="audit-ledger__event-type">
                        {labelize(
                          event.eventType,
                        )}
                      </span>

                      <span
                        className={`audit-ledger__status audit-ledger__status--${event.status}`}
                      >
                        {statusLabel(
                          event.status,
                        )}
                      </span>

                      {index === 0 ? (
                        <span className="audit-ledger__latest">
                          LATEST
                        </span>
                      ) : null}
                    </div>

                    <strong>
                      {
                        event.paymentId
                      }
                    </strong>

                    <span className="audit-ledger__timestamp">
                      {formatDate(
                        event.createdAt,
                      )}
                    </span>

                    <p className="audit-ledger__summary">
                      {eventSummary(
                        event,
                      )}
                    </p>
                  </div>

                  <div className="audit-ledger__event-meta">
                    <div>
                      <span>
                        INTERVENTION
                      </span>

                      <strong>
                        {event.intervention
                          ? labelize(
                              event.intervention,
                            )
                          : "—"}
                      </strong>
                    </div>

                    <div>
                      <span>
                        EVENT ID
                      </span>

                      <strong>
                        {event.eventId ??
                          "MANUAL"}
                      </strong>
                    </div>

                    <div>
                      <span>
                        AUDIT ID
                      </span>

                      <strong>
                        {event.id}
                      </strong>
                    </div>
                  </div>

                  <details className="audit-ledger__details">
                    <summary>
                      Inspect event details
                    </summary>

                    <pre>
                      {JSON.stringify(
                        event.details,
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </article>
              ),
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}