import { NextResponse } from "next/server";

import { razorpayConfigured } from "@/lib/razorpay";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return NextResponse.json({
    service: "reclaim",
    environment:
      process.env.NODE_ENV ===
      "production"
        ? "production"
        : "development",
    provider: "razorpay",
    mode: "test",
    razorpayConfigured:
      razorpayConfigured(),
    recoveryEngine:
      "online",
    policyEngine:
      "deterministic",
    guardrails:
      "fail-closed",
    aiBoundary:
      "policy-constrained",
    timestamp:
      new Date().toISOString(),
  });
}