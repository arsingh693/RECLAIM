import type {
  DeclineCode,
  FailedPayment,
  Intervention,
  PaymentMethod,
} from "@/domain/types";

import {
  decideWithAgent,
} from "@/ai/decisionAgent";

import {
  StubAIProvider,
} from "@/ai/stubProvider";

import {
  buildDecision,
} from "@/orchestration/recoveryRunner";

import {
  evaluateGuardrails,
} from "@/policy/guardrails";

import {
  getCandidateActions,
} from "@/policy/candidateActions";

import type {
  RecoveryLinkResult,
} from "@/gateway/types";

import {
  appendAuditEvent,
} from "@/lib/reclaimAudit";

import {
  getRecoveryLink,
  setRecoveryLink,
} from "@/lib/reclaimRecoveryStore";

import {
  razorpayRequest,
} from "@/lib/razorpay";

/**
 * Map a Razorpay failure/error description into RECLAIM's
 * deterministic decline taxonomy.
 *
 * Unknown failures fail closed into DO_NOT_HONOUR rather than
 * manufacturing a new category.
 */
function mapRazorpayErrorToDeclineCode(
  error: unknown,
): DeclineCode {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error ?? "").toLowerCase();

  if (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("gateway")
  ) {
    return "GATEWAY_TIMEOUT";
  }

  if (
    message.includes("insufficient") ||
    message.includes("fund")
  ) {
    return "INSUFFICIENT_FUNDS";
  }

  if (
    message.includes("do_not_honour") ||
    message.includes("do not honour") ||
    message.includes("do not honor")
  ) {
    return "DO_NOT_HONOUR";
  }

  if (
    message.includes("expired") ||
    message.includes("expiry")
  ) {
    return "CARD_EXPIRED";
  }

  if (
    message.includes("invalid") &&
    message.includes("instrument")
  ) {
    return "INVALID_INSTRUMENT";
  }

  if (
    message.includes("invalid") &&
    message.includes("card")
  ) {
    return "INVALID_INSTRUMENT";
  }

  if (
    message.includes("blocked") ||
    message.includes("restricted")
  ) {
    return "CARD_BLOCKED";
  }

  if (
    message.includes("authentication") ||
    message.includes("authenticated") ||
    message.includes("authentication_failed")
  ) {
    return "AUTHENTICATION_FAILED";
  }

  if (
    message.includes("mandate") &&
    message.includes("paused")
  ) {
    return "MANDATE_PAUSED";
  }

  if (
    message.includes("mandate") &&
    message.includes("limit")
  ) {
    return "MANDATE_LIMIT_EXCEEDED";
  }

  if (
    message.includes("limit") &&
    message.includes("exceed")
  ) {
    return "LIMIT_EXCEEDED";
  }

  return "DO_NOT_HONOUR";
}

/**
 * Normalise the payment method coming from Razorpay.
 */
function normaliseMethod(
  method: unknown,
): PaymentMethod {
  switch (method) {
    case "card":
      return "card";

    case "upi":
      return "upi";

    case "netbanking":
      return "netbanking";

    case "wallet":
      return "wallet";

    default:
      return "card";
  }
}

function readNumber(
  value: unknown,
  fallback: number,
): number {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (
    typeof value === "string" &&
    value.trim() !== ""
  ) {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function readNullableNumber(
  value: unknown,
): number | null {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (
    typeof value === "string" &&
    value.trim() !== ""
  ) {
    const parsed = Number(value);

    return Number.isFinite(parsed)
      ? parsed
      : null;
  }

  return null;
}

function readBoolean(
  value: unknown,
  fallback: boolean,
): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value === "true") {
      return true;
    }

    if (value === "false") {
      return false;
    }
  }

  return fallback;
}

function readNotes(
  payment: Record<string, unknown>,
): Record<string, unknown> {
  if (
    typeof payment.notes === "object" &&
    payment.notes !== null
  ) {
    return payment.notes as Record<
      string,
      unknown
    >;
  }

  return {};
}

/**
 * Convert the authoritative Razorpay payment object into
 * the domain representation used by RECLAIM.
 */
function buildFailedPayment(
  razorpayPayment: Record<string, unknown>,
): FailedPayment {
  const paymentId = String(
    razorpayPayment.id ?? "",
  );

  if (!paymentId.startsWith("pay_")) {
    throw new Error(
      "Invalid Razorpay payment identifier.",
    );
  }

  const status =
    typeof razorpayPayment.status === "string"
      ? razorpayPayment.status
      : "";

  if (status !== "failed") {
    throw new Error(
      `Razorpay payment ${paymentId} is not failed.`,
    );
  }

  const amountPaise = readNumber(
    razorpayPayment.amount,
    0,
  );

  if (
    !Number.isSafeInteger(amountPaise) ||
    amountPaise <= 0
  ) {
    throw new Error(
      "Razorpay payment amount is invalid.",
    );
  }

  const method = normaliseMethod(
    razorpayPayment.method,
  );

  const notes =
    readNotes(razorpayPayment);

  const rawErrorCode =
    typeof razorpayPayment.error_code ===
    "string"
      ? razorpayPayment.error_code
      : "";

  const rawErrorDescription =
    typeof razorpayPayment.error_description ===
    "string"
      ? razorpayPayment.error_description
      : "";

  const rawReason =
    rawErrorCode ||
    rawErrorDescription ||
    "Razorpay payment failed.";

  const declineCode =
    mapRazorpayErrorToDeclineCode(
      `${rawErrorCode} ${rawErrorDescription}`,
    );

  const createdAt =
    typeof razorpayPayment.created_at ===
    "number"
      ? razorpayPayment.created_at
      : null;

  const failedAt =
    createdAt !== null &&
    Number.isFinite(createdAt)
      ? new Date(
          createdAt * 1000,
        ).toISOString()
      : new Date().toISOString();

  const chargeKind =
    notes.charge_kind ===
      "subscription_renewal"
      ? "subscription_renewal"
      : "one_time";

  const merchantId =
    typeof notes.merchant_id === "string" &&
    notes.merchant_id.trim() !== ""
      ? notes.merchant_id
      : "razorpay";

  const availableMethods =
    method === "card"
      ? ["card", "upi"] as PaymentMethod[]
      : [method];

  const successfulChargesLifetime =
    Math.max(
      0,
      Math.floor(
        readNumber(
          notes.successful_charges_lifetime,
          0,
        ),
      ),
    );

  const consecutiveFailures =
    Math.max(
      0,
      Math.floor(
        readNumber(
          notes.consecutive_failures,
          1,
        ),
      ),
    );

  const historicalPaydayHint =
    readNullableNumber(
      notes.historical_payday_hint,
    );

  const contactOptOut =
    readBoolean(
      notes.contact_opt_out,
      false,
    );

  const hasOpenDispute =
    readBoolean(
      notes.has_open_dispute,
      false,
    );

  const mandateCeilingPaise =
    readNullableNumber(
      notes.mandate_ceiling_paise,
    );

  return {
    id: paymentId,
    merchantId,
    chargeKind,
    amountPaise,
    currency: "INR",
    method,
    declineCode,
    gatewayRawReason: rawReason,
    failedAt,
    attemptsSoFar: Math.max(
      0,
      Math.floor(
        readNumber(
          notes.attempts_so_far,
          0,
        ),
      ),
    ),
    customer: {
  customerId:
    typeof notes.customer_id === "string" &&
    notes.customer_id.trim() !== ""
      ? notes.customer_id
      : paymentId,

  timezone:
    typeof notes.timezone === "string" &&
    notes.timezone.trim() !== ""
      ? notes.timezone
      : "Asia/Kolkata",

  availableMethods,
  successfulChargesLifetime,
  consecutiveFailures,
  historicalPaydayHint,
  contactOptOut,
  hasOpenDispute,
},
    mandateCeilingPaise,
  };
}

function candidateInterventions(
  candidates: readonly Intervention[],
): readonly Intervention[] {
  return candidates;
}

function chooseFallbackIntervention(
  payment: FailedPayment,
): Intervention {
  switch (payment.declineCode) {
    case "GATEWAY_TIMEOUT":
      return "RECONCILE_THEN_DECIDE";

    case "CARD_EXPIRED":
    case "INVALID_INSTRUMENT":
      return "REQUEST_INSTRUMENT_UPDATE";

    case "AUTHENTICATION_FAILED":
      return "REQUEST_REAUTHORIZATION";

    case "RISK_BLOCKED":
      return "STOP_PERMANENT";

    case "CARD_BLOCKED":
      return "REQUEST_INSTRUMENT_UPDATE";

    case "DO_NOT_HONOUR":
      return "ESCALATE_HUMAN";

    case "MANDATE_PAUSED":
    case "MANDATE_LIMIT_EXCEEDED":
      return "ESCALATE_HUMAN";

    case "INSUFFICIENT_FUNDS":
      return "RETRY_SCHEDULED";

    case "ISSUER_UNAVAILABLE":
      return "RETRY_SCHEDULED";

    case "LIMIT_EXCEEDED":
      return "RETRY_SPLIT_AMOUNT";

    default:
      return "STOP_PERMANENT";
  }
}

/**
 * Create a Razorpay Payment Link for a customer-action recovery.
 *
 * This is deliberately separate from charge execution:
 * a Payment Link asks the customer to complete payment and
 * does not perform a blind server-side retry.
 */
async function createRecoveryLink(
  payment: FailedPayment,
  eventId: string,
): Promise<RecoveryLinkResult> {
  try {
    const response =
      await razorpayRequest<
        Record<string, unknown>
      >(
        "/payment_links",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            amount:
              payment.amountPaise,
            currency: "INR",
            reference_id: eventId,
            description:
              `RECLAIM recovery for ${payment.id}`,
            notes: {
              reclaim_payment_id:
                payment.id,
            },
          }),
        },
      );

    const gatewayReference =
      typeof response.id === "string"
        ? response.id
        : null;

    const url =
      typeof response.short_url === "string"
        ? response.short_url
        : null;

    if (
      gatewayReference === null ||
      url === null
    ) {
      return {
        paymentId: payment.id,
        supported: true,
        url,
        gatewayReference,
        reason:
          "Razorpay created a payment link without returning a usable short URL.",
      };
    }

    return {
      paymentId: payment.id,
      supported: true,
      url,
      gatewayReference,
      reason: null,
    };
  } catch (error) {
    return {
      paymentId: payment.id,
      supported: false,
      url: null,
      gatewayReference: null,
      reason:
        error instanceof Error
          ? error.message
          : "Unable to create Razorpay recovery link.",
    };
  }
}

export interface RazorpayRecoveryResult {
  readonly paymentId: string;
  readonly status: string;
  readonly declineCode: DeclineCode;
  readonly candidates: readonly Intervention[];
  readonly intervention: Intervention | null;
  readonly decisionSource:
    | "llm"
    | "fallback";
  readonly reasoning: string;
  readonly confidence: number;
  readonly scheduledFor: string | null;
  readonly switchToMethod:
    | PaymentMethod
    | null;
  readonly splitAmountPaise:
    | number
    | null;
  readonly guardrail: boolean;
  readonly blockedBy: readonly string[];
  readonly execution:
    | "not_executed"
    | "customer_action_required";
  readonly recoveryLink:
    | RecoveryLinkResult
    | null;
}

export interface EvaluateRazorpayRecoveryOptions {
  readonly createRecoveryLink?: boolean;
  readonly eventId?: string;
}

export async function evaluateRazorpayRecovery(
  paymentId: string,
  options: EvaluateRazorpayRecoveryOptions = {},
): Promise<RazorpayRecoveryResult> {
  const razorpayPayment =
    await razorpayRequest<
      Record<string, unknown>
    >(
      `/payments/${encodeURIComponent(
        paymentId,
      )}`,
    );

  const payment =
    buildFailedPayment(
      razorpayPayment,
    );

  const candidates =
    getCandidateActions(payment);

  const fallbackIntervention =
    chooseFallbackIntervention(
      payment,
    );

  const agentResult =
    await decideWithAgent(
      payment,
      {
        provider:
          new StubAIProvider(),
        fallbackIntervention,
      },
    );

  const intervention =
    agentResult.intervention ??
    fallbackIntervention;

  const decision =
    buildDecision(
      payment,
      agentResult,
      intervention,
    );

  const guardrail =
    evaluateGuardrails(
      payment,
      decision,
    );

  const eventId =
    options.eventId ??
    `manual-${Date.now()}`;

  let recoveryLink:
    | RecoveryLinkResult
    | null = null;

  let execution:
    | "not_executed"
    | "customer_action_required" =
    "not_executed";

  /**
   * Customer-action recovery is only allowed after
   * deterministic guardrails authorize the decision.
   */
  if (
    options.createRecoveryLink === true &&
    guardrail.allowed
  ) {
    const existing =
      getRecoveryLink(
        payment.id,
      );

    if (existing) {
      recoveryLink = {
        paymentId:
          payment.id,
        supported: true,
        url: existing.url,
        gatewayReference:
          existing.gatewayReference,
        reason: null,
      };

      execution =
        "customer_action_required";
    } else {
      const created =
        await createRecoveryLink(
          payment,
          eventId,
        );

      recoveryLink = created;

      if (
        created.supported &&
        created.url &&
        created.gatewayReference
      ) {
        setRecoveryLink({
          paymentId: payment.id,
          url: created.url,
          gatewayReference: created.gatewayReference,
          createdAt: new Date().toISOString(),
        });

        execution =
          "customer_action_required";

        appendAuditEvent({
          eventType:
            "RECOVERY_LINK_CREATED",
          paymentId:
            payment.id,
          eventId,
          intervention,
          status: "allowed",
          details: {
            gatewayReference:
              created.gatewayReference,
            url: created.url,
          },
        });
      } else {
        appendAuditEvent({
          eventType:
            "RECOVERY_LINK_FAILED",
          paymentId:
            payment.id,
          eventId,
          intervention,
          status: "blocked",
          details: {
            reason:
              created.reason,
          },
        });
      }
    }
  }

  appendAuditEvent({
    eventType: guardrail.allowed
      ? "RECOVERY_EVALUATED"
      : "RECOVERY_BLOCKED",
    paymentId: payment.id,
    eventId,
    intervention,
    status: guardrail.allowed
      ? "allowed"
      : "blocked",
    details: {
      declineCode:
        payment.declineCode,
      candidates:
        candidateInterventions(
          candidates,
        ),
      guardrail: {
        allowed:
          guardrail.allowed,
        blockedBy:
          guardrail.blockedBy,
        notes:
          guardrail.notes,
      },
      aiSource:
        agentResult.source,
      reasoning:
        agentResult.reasoning,
      scheduledFor:
        decision.scheduledFor,
      switchToMethod:
        decision.switchToMethod,
      splitAmountPaise:
        decision.splitAmountPaise,
    },
  });

  return {
    paymentId:
      payment.id,
    status: "failed",
    declineCode:
      payment.declineCode,
    candidates:
      candidateInterventions(
        candidates,
      ),
    intervention,
    decisionSource:
      agentResult.source,
    reasoning:
      agentResult.reasoning,
    confidence:
      agentResult.confidence,
    scheduledFor:
      decision.scheduledFor,
    switchToMethod:
      decision.switchToMethod,
    splitAmountPaise:
      decision.splitAmountPaise,
    guardrail:
      guardrail.allowed,
    blockedBy:
      guardrail.blockedBy,
    execution,
    recoveryLink,
  };
}