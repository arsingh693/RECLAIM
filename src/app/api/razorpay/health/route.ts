import { NextResponse } from "next/server";

import {
  razorpayConfigured,
  razorpayRequest,
} from "../../../../lib/razorpay";

interface RazorpayPaymentsResponse {
  readonly entity?: string;
  readonly count?: number;
  readonly items?: readonly unknown[];
}

export async function GET(): Promise<Response> {
  try {
    if (!razorpayConfigured()) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Razorpay credentials are not configured.",
        },
        { status: 500 },
      );
    }

    const payments =
      await razorpayRequest<RazorpayPaymentsResponse>(
        "/payments?count=1",
      );

    return NextResponse.json({
      ok: true,
      provider: "razorpay",
      mode: "test",
      authenticated: true,
      paymentCount:
        payments.count ?? 0,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Razorpay connection failed";

    return NextResponse.json(
      {
        ok: false,
        provider: "razorpay",
        authenticated: false,
        error: message,
      },
      { status: 502 },
    );
  }
}