const BASE_URL =
  process.env.RECLAIM_BASE_URL ??
  "http://localhost:3000";

const paymentId = process.argv[2];

if (!paymentId) {
  throw new Error(
    "Usage: npm run proof:recovery -- <paymentId>"
  );
}

async function request(path, options = {}) {
  const response = await fetch(
    `${BASE_URL}${path}`,
    {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    },
  );

  const text = await response.text();

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new Error(
      `${path} returned HTTP ${response.status}: ${
        typeof body === "string"
          ? body
          : JSON.stringify(body)
      }`,
    );
  }

  return body;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`PROOF FAILED: ${message}`);
  }
}

console.log("");
console.log("RECLAIM REAL RECOVERY PROOF");
console.log("============================");
console.log(`Payment: ${paymentId}`);
console.log(`Base URL: ${BASE_URL}`);
console.log("");

console.log("[1/3] Fetching recovery decision...");

const recovery = await request(
  "/api/razorpay/recovery",
  {
    method: "POST",
    body: JSON.stringify({
      paymentId,
      createRecoveryLink: true,
    }),
  },
);

console.log(
  JSON.stringify(
    {
      paymentId: recovery.paymentId,
      status: recovery.status,
      declineCode: recovery.declineCode,
      candidates: recovery.candidates,
      intervention: recovery.intervention,
      decisionSource: recovery.decisionSource,
      scheduledFor: recovery.scheduledFor,
      switchToMethod: recovery.switchToMethod,
      splitAmountPaise: recovery.splitAmountPaise,
      guardrail: recovery.guardrail,
      blockedBy: recovery.blockedBy,
      execution: recovery.execution,
      recoveryLink:
        recovery.recoveryLink
          ? {
              supported:
                recovery.recoveryLink.supported,
              url:
                recovery.recoveryLink.url,
              gatewayReference:
                recovery.recoveryLink.gatewayReference,
            }
          : null,
    },
    null,
    2,
  ),
);

assert(
  recovery.paymentId === paymentId,
  "Payment ID mismatch.",
);

assert(
  recovery.status === "failed",
  `Expected failed payment, got ${recovery.status}.`,
);

assert(
  typeof recovery.declineCode === "string" &&
    recovery.declineCode.length > 0,
  "Decline taxonomy was not produced.",
);

assert(
  Array.isArray(recovery.candidates) &&
    recovery.candidates.length > 0,
  "Policy candidate set is empty.",
);

assert(
  typeof recovery.intervention === "string",
  "No recovery intervention was selected.",
);

assert(
  recovery.candidates.includes(
    recovery.intervention,
  ),
  "AI selected an intervention outside the policy candidate set.",
);

assert(
  recovery.decisionSource === "llm" ||
    recovery.decisionSource === "fallback",
  "Invalid decision source.",
);

assert(
  typeof recovery.confidence === "number" &&
    recovery.confidence >= 0 &&
    recovery.confidence <= 1,
  "Invalid AI confidence.",
);

assert(
  typeof recovery.guardrail === "boolean",
  "Guardrail result missing.",
);

assert(
  Array.isArray(recovery.blockedBy),
  "Guardrail block list missing.",
);

assert(
  recovery.guardrail === true,
  `Recovery was blocked: ${recovery.blockedBy.join(", ")}`,
);

assert(
  recovery.recoveryLink?.supported === true,
  "Razorpay recovery link was not created.",
);

assert(
  typeof recovery.recoveryLink?.url === "string" &&
    recovery.recoveryLink.url.length > 0,
  "Recovery link URL missing.",
);

assert(
  typeof recovery.recoveryLink?.gatewayReference === "string" &&
    recovery.recoveryLink.gatewayReference.length > 0,
  "Razorpay gateway reference missing.",
);

console.log("");
console.log("[2/3] Reading audit ledger...");

const audit = await request(
  "/api/razorpay/audit",
  {
    method: "GET",
    cache: "no-store",
  },
);

const events = Array.isArray(audit.events)
  ? audit.events
  : [];

const paymentEvents = events.filter(
  (event) =>
    event &&
    typeof event === "object" &&
    event.paymentId === paymentId,
);

console.log(
  JSON.stringify(
    {
      provider: audit.provider,
      paymentEvents,
      totalEvents: events.length,
    },
    null,
    2,
  ),
);

assert(
  paymentEvents.length > 0,
  "No audit events were recorded for this payment.",
);

const hasEvaluationEvent =
  paymentEvents.some(
    (event) =>
      event.eventType ===
        "RECOVERY_EVALUATED" ||
      event.eventType ===
        "RECOVERY_BLOCKED",
  );

assert(
  hasEvaluationEvent,
  "Recovery evaluation event missing from audit ledger.",
);

const hasLinkEvent =
  paymentEvents.some(
    (event) =>
      event.eventType ===
        "RECOVERY_LINK_CREATED",
  );

assert(
  hasLinkEvent,
  "Recovery link creation event missing from audit ledger.",
);

console.log("");
console.log("[3/3] Verifying recovery invariants...");

assert(
  recovery.candidates.includes(
    recovery.intervention,
  ),
  "Candidate containment invariant failed.",
);

assert(
  recovery.guardrail === true &&
    recovery.blockedBy.length === 0,
  "Guardrail authorization invariant failed.",
);

assert(
  recovery.execution ===
    "customer_action_required",
  `Unexpected execution state: ${recovery.execution}`,
);

console.log("");
console.log("============================");
console.log("REAL RECOVERY PROOF PASSED");
console.log("============================");
console.log(
  `Gateway state → taxonomy → policy → AI → guardrails → audit`,
);
console.log(
  `Intervention: ${recovery.intervention}`,
);
console.log(
  `Guardrails: AUTHORIZED`,
);
console.log(
  `Recovery link: ${recovery.recoveryLink.url}`,
);
console.log(
  `Gateway reference: ${recovery.recoveryLink.gatewayReference}`,
);
console.log(
  `Audit events: ${paymentEvents.length}`,
);
console.log("");
