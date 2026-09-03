import { NextResponse } from "next/server";

import { razorpayConfigured, razorpayRequest } from "@/lib/razorpay";
import { RazorpayGateway } from "@/gateway/razorpay";
import type { FailedPayment, PaymentMethod } from "@/domain/types";

interface RazorpayPayment {
  readonly id: string;
  readonly entity: "payment";
  readonly amount: number;
  readonly currency: string;
  readonly status: string;
  readonly method?: string;
  readonly description?: string;
  readonly error_code?: string | null;
  readonly error_description?: string | null;
  readonly error_reason?: string | null;
  readonly order_id?: string | null;
  readonly captured?: boolean;
}

function isPaymentMethod(value: string | undefined): PaymentMethod {
  switch (value) {
    case "card":
      return "card";
    case "upi":
      return "upi";
    default:
      return "card";
  }
}

function mapToFailedPayment(
  payment: RazorpayPayment,
): FailedPayment {
  return {
    id: payment.id,
    merchantId: "razorpay-test",
    chargeKind: "one_time",
    amountPaise: payment.amount,
    currency: "INR",
    method: isPaymentMethod(payment.method),
    declineCode: "DO_NOT_HONOUR",
    gatewayRawReason:
      payment.error_description ??
      payment.error_reason ??
      payment.error_code ??
      "Razorpay payment failed",
    failedAt: new Date().toISOString(),
    attemptsSoFar: 1,
    customer: {
  customerId: `razorpay_${payment.id}`,
  successfulChargesLifetime: 0,
  consecutiveFailures: 1,
  availableMethods: ["card", "upi"],
  historicalPaydayHint: null,
  contactOptOut: false,
  hasOpenDispute: false,
  timezone: "Asia/Kolkata",
},
    mandateCeilingPaise: null,
  };
}

/**
 * GET /api/razorpay/payments/:id
 *
 * Reads a real Razorpay payment and returns a normalized
 * RECLAIM payment view.
 */
export async function GET(
  _request: Request,
  context: {
    params: Promise<{ id: string }>;
  },
): Promise<Response> {
  if (!razorpayConfigured()) {
    return NextResponse.json(
      {
        error:
          "Razorpay credentials are not configured.",
      },
      { status: 503 },
    );
  }

  const { id } = await context.params;

  if (!id || !id.startsWith("pay_")) {
    return NextResponse.json(
      {
        error: "Invalid Razorpay payment ID.",
      },
      { status: 400 },
    );
  }

  try {
    const payment =
      await razorpayRequest<RazorpayPayment>(
        `/payments/${encodeURIComponent(id)}`,
      );

    return NextResponse.json({
      provider: "razorpay",
      mode: "test",
      payment,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch Razorpay payment.",
      },
      { status: 502 },
    );
  }
}

/**
 * POST /api/razorpay/payments/:id
 *
 * Creates a Razorpay Payment Link for recovery.
 *
 * This endpoint deliberately does not attempt a blind server-side
 * retry of the failed payment.
 */
export async function POST(
  _request: Request,
  context: {
    params: Promise<{ id: string }>;
  },
): Promise<Response> {
  if (!razorpayConfigured()) {
    return NextResponse.json(
      {
        error:
          "Razorpay credentials are not configured.",
      },
      { status: 503 },
    );
  }

  const { id } = await context.params;

  if (!id || !id.startsWith("pay_")) {
    return NextResponse.json(
      {
        error: "Invalid Razorpay payment ID.",
      },
      { status: 400 },
    );
  }

  try {
    const payment =
      await razorpayRequest<RazorpayPayment>(
        `/payments/${encodeURIComponent(id)}`,
      );

    if (payment.status.toLowerCase() === "captured") {
      return NextResponse.json(
        {
          error:
            "Payment is already captured. Recovery collection is not required.",
          status: "captured",
          paymentId: payment.id,
        },
        { status: 409 },
      );
    }

    if (payment.status.toLowerCase() !== "failed") {
      return NextResponse.json(
        {
          error:
            `Payment is not recoverable from its current state: ${payment.status}`,
          status: payment.status,
          paymentId: payment.id,
        },
        { status: 409 },
      );
    }

    const normalizedPayment =
      mapToFailedPayment(payment);

    const gateway = new RazorpayGateway({
      keyId: process.env.RAZORPAY_KEY_ID ?? "",
      keySecret:
        process.env.RAZORPAY_KEY_SECRET ?? "",
    });

    const recovery =
      await gateway.createRecoveryLink({
        payment: normalizedPayment,
        amountPaise: payment.amount,
        referenceId: `reclaim-${payment.id}`.slice(
          0,
          40,
        ),
        description:
          "RECLAIM payment recovery",
      });

    return NextResponse.json({
      provider: "razorpay",
      mode: "test",
      paymentId: payment.id,
      status: payment.status,
      recovery,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create Razorpay recovery link.",
      },
      { status: 502 },
    );
  }
}