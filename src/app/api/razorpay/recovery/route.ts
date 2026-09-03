import { NextResponse } from "next/server";
import {
  evaluateRazorpayRecovery,
} from "@/lib/razorpayRecovery";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
) {
  try {
    const body = await request.json();

    const paymentId =
      typeof body?.paymentId === "string"
        ? body.paymentId.trim()
        : "";

    const createRecoveryLink =
      body?.createRecoveryLink === true;

    if (!paymentId) {
      return NextResponse.json(
        {
          error:
            "paymentId is required.",
        },
        {
          status: 400,
        },
      );
    }

    const result =
      await evaluateRazorpayRecovery(
        paymentId,
        {
          createRecoveryLink,
          eventId: `manual-${Date.now()}`,
        },
      );

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to evaluate recovery.",
      },
      {
        status: 500,
      },
    );
  }
}