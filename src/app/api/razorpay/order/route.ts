import { NextResponse } from "next/server";

import { razorpayConfigured, razorpayRequest } from "@/lib/razorpay";

interface RazorpayOrder {
  readonly id: string;
  readonly entity: "order";
  readonly amount: number;
  readonly amount_paid: number;
  readonly amount_due: number;
  readonly currency: string;
  readonly status: string;
  readonly receipt?: string;
}

interface CreateOrderBody {
  readonly amountPaise?: unknown;
  readonly receipt?: unknown;
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null
  );
}

export async function POST(
  request: Request,
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

  let body: CreateOrderBody;

  try {
    const parsed: unknown =
      await request.json();

    body = isRecord(parsed)
      ? (parsed as CreateOrderBody)
      : {};
  } catch {
    return NextResponse.json(
      {
        error: "Invalid JSON request body.",
      },
      { status: 400 },
    );
  }

  const amountPaise =
    typeof body.amountPaise === "number"
      ? body.amountPaise
      : null;

  if (
    amountPaise === null ||
    !Number.isSafeInteger(amountPaise) ||
    amountPaise < 10
  ) {
    return NextResponse.json(
      {
        error:
          "amountPaise must be an integer of at least 10 paise.",
      },
      { status: 400 },
    );
  }

  const receipt =
    typeof body.receipt === "string" &&
    body.receipt.trim().length > 0
      ? body.receipt.trim().slice(0, 40)
      : `reclaim_${Date.now()}`;

  try {
    const order =
      await razorpayRequest<RazorpayOrder>(
        "/orders",
        {
          method: "POST",
          body: JSON.stringify({
            amount: amountPaise,
            currency: "INR",
            receipt,
            notes: {
              source: "reclaim",
            },
          }),
        },
      );

    return NextResponse.json({
      provider: "razorpay",
      mode: "test",
      order,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create Razorpay order.",
      },
      { status: 502 },
    );
  }
}