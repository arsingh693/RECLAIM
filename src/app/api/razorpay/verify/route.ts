import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

import { razorpayConfigured } from "@/lib/razorpay";

interface VerifyBody {
  razorpay_order_id?: unknown;
  razorpay_payment_id?: unknown;
  razorpay_signature?: unknown;
}

function isValidString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export async function POST(
  request: Request,
): Promise<Response> {
  if (!razorpayConfigured()) {
    return NextResponse.json(
      {
        error: "Razorpay credentials are not configured.",
      },
      { status: 503 },
    );
  }

  let body: VerifyBody;

  try {
    body = (await request.json()) as VerifyBody;
  } catch {
    return NextResponse.json(
      {
        error: "Invalid JSON request body.",
      },
      { status: 400 },
    );
  }

  const orderId = body.razorpay_order_id;
  const paymentId = body.razorpay_payment_id;
  const signature = body.razorpay_signature;

  if (
    !isValidString(orderId) ||
    !isValidString(paymentId) ||
    !isValidString(signature)
  ) {
    return NextResponse.json(
      {
        error: "Missing Razorpay payment verification fields.",
      },
      { status: 400 },
    );
  }

  const secret = process.env.RAZORPAY_KEY_SECRET;

  if (!secret) {
    return NextResponse.json(
      {
        error: "Razorpay secret is not configured.",
      },
      { status: 503 },
    );
  }

  const expectedSignature = createHmac(
    "sha256",
    secret,
  )
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  const expectedBuffer = Buffer.from(
    expectedSignature,
    "utf8",
  );

  const receivedBuffer = Buffer.from(
    signature,
    "utf8",
  );

  const verified =
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(
      expectedBuffer,
      receivedBuffer,
    );

  if (!verified) {
    return NextResponse.json(
      {
        verified: false,
        error: "Invalid Razorpay payment signature.",
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    verified: true,
    provider: "razorpay",
    mode: "test",
    orderId,
    paymentId,
  });
}