import { NextResponse } from "next/server";
import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

import {
  evaluateRazorpayRecovery,
} from "@/lib/razorpayRecovery";

import {
  hasProcessedEvent,
  getInFlightEvent,
  markEventProcessed,
  registerInFlightEvent,
  clearInFlightEvent,
} from "@/lib/razorpayWebhookStore";

interface RazorpayWebhookPayment {
  id?: unknown;
  amount?: unknown;
  currency?: unknown;
  status?: unknown;
  method?: unknown;
  order_id?: unknown;
  email?: unknown;
  contact?: unknown;
  error_code?: unknown;
  error_description?: unknown;
  error_reason?: unknown;
  created_at?: unknown;
  notes?: unknown;
}

interface RazorpayWebhookPayload {
  entity?: unknown;
  event?: unknown;
  created_at?: unknown;
  payload?: {
    payment?: {
      entity?: RazorpayWebhookPayment;
    };
  };
}

const WEBHOOK_SECRET =
  process.env.RAZORPAY_WEBHOOK_SECRET;

function verifySignature(
  rawBody: string,
  signature: string,
): boolean {
  if (
    !WEBHOOK_SECRET ||
    !signature
  ) {
    return false;
  }

  const expected =
    createHmac(
      "sha256",
      WEBHOOK_SECRET,
    )
      .update(rawBody)
      .digest("hex");

  const expectedBuffer =
    Buffer.from(
      expected,
      "utf8",
    );

  const receivedBuffer =
    Buffer.from(
      signature,
      "utf8",
    );

  if (
    expectedBuffer.length !==
    receivedBuffer.length
  ) {
    return false;
  }

  return timingSafeEqual(
    expectedBuffer,
    receivedBuffer,
  );
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null
  );
}

function asString(
  value: unknown,
): string | null {
  return typeof value === "string"
    ? value
    : null;
}

export async function POST(
  request: Request,
): Promise<Response> {
  if (!WEBHOOK_SECRET) {
    console.error(
      "RAZORPAY_WEBHOOK_SECRET is not configured",
    );

    return NextResponse.json(
      {
        error:
          "Webhook endpoint is not configured",
      },
      { status: 500 },
    );
  }

  const rawBody =
    await request.text();

  const signature =
    request.headers.get(
      "x-razorpay-signature",
    );

  if (
    !verifySignature(
      rawBody,
      signature ?? "",
    )
  ) {
    return NextResponse.json(
      {
        error:
          "Invalid webhook signature",
      },
      { status: 401 },
    );
  }

  const eventId =
    request.headers.get(
      "x-razorpay-event-id",
    );

  if (!eventId) {
    return NextResponse.json(
      {
        error:
          "Missing Razorpay event id",
      },
      { status: 400 },
    );
  }

  const inFlight =
    getInFlightEvent(
      eventId,
    );

  if (inFlight) {
    try {
      await inFlight;
    } catch {
      // The first request already owns
      // execution for this event.
    }

    return NextResponse.json(
      {
        received: true,
        eventId,
        duplicate: true,
        status:
          "already_processing",
      },
      { status: 200 },
    );
  }

  if (
    hasProcessedEvent(
      eventId,
    )
  ) {
    return NextResponse.json(
      {
        received: true,
        eventId,
        duplicate: true,
        status:
          "already_processed",
      },
      { status: 200 },
    );
  }

  let body: unknown;

  try {
    body = JSON.parse(
      rawBody,
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "Invalid JSON payload",
      },
      { status: 400 },
    );
  }

  if (!isRecord(body)) {
    return NextResponse.json(
      {
        error:
          "Invalid webhook payload",
      },
      { status: 400 },
    );
  }

  const webhook =
    body as RazorpayWebhookPayload;

  const event =
    asString(
      webhook.event,
    );

  if (!event) {
    return NextResponse.json(
      {
        error:
          "Webhook event is missing",
      },
      { status: 400 },
    );
  }

  console.log(
    "Razorpay webhook received:",
    {
      eventId,
      event,
    },
  );

  /*
   * We acknowledge events we don't use.
   */
  if (
    event !== "payment.failed"
  ) {
    return NextResponse.json(
      {
        received: true,
        eventId,
        event,
        ignored:
          event !==
            "payment.authorized" &&
          event !==
            "payment.captured",
      },
      { status: 200 },
    );
  }

  const paymentEntity =
    webhook.payload
      ?.payment
      ?.entity;

  if (!paymentEntity) {
    return NextResponse.json(
      {
        error:
          "payment.failed payload is missing payment entity",
      },
      { status: 400 },
    );
  }

  const paymentId =
    asString(
      paymentEntity.id,
    );

  if (!paymentId) {
    return NextResponse.json(
      {
        error:
          "payment.failed payload is missing payment id",
      },
      { status: 400 },
    );
  }

  console.log(
    "RECLAIM recovery candidate:",
    {
      eventId,
      paymentId,
      amountPaise:
        paymentEntity.amount ??
        null,
      errorCode:
        paymentEntity.error_code ??
        null,
      errorReason:
        paymentEntity.error_reason ??
        null,
    },
  );

  let resolveInFlight:
    | (() => void)
    | undefined;

  let rejectInFlight:
    | ((error: unknown) => void)
    | undefined;

  const completion =
    new Promise<void>(
      (
        resolve,
        reject,
      ) => {
        resolveInFlight =
          resolve;
        rejectInFlight =
          reject;
      },
    );

  registerInFlightEvent(
    eventId,
    completion,
  );

  try {
    const recovery =
  await evaluateRazorpayRecovery(
    paymentId,
    {
      createRecoveryLink: true,
      eventId,
    },
  );

    console.log(
  "RECLAIM recovery decision:",
  {
    eventId,
    paymentId,
    intervention:
      recovery.intervention,
    guardrailAllowed:
      recovery.guardrail,
    blockedBy:
      recovery.blockedBy,
  },
);

    markEventProcessed(
      eventId,
    );

    resolveInFlight?.();

    return NextResponse.json(
      {
        received: true,
        eventId,
        event,
        recovery,
      },
      { status: 200 },
    );
  } catch (
    error: unknown
  ) {
    rejectInFlight?.(
      error,
    );

    console.error(
      "RECLAIM recovery evaluation failed:",
      {
        eventId,
        paymentId,
        error:
          error instanceof
          Error
            ? error.message
            : String(error),
      },
    );

    return NextResponse.json(
      {
        error:
          error instanceof
          Error
            ? error.message
            : "Recovery evaluation failed",
      },
      { status: 502 },
    );
  } finally {
    clearInFlightEvent(
      eventId,
    );
  }
}
