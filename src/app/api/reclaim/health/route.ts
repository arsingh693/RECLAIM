import { NextResponse } from "next/server";

import { razorpayConfigured } from "@/lib/razorpay";
import { getAuditEvents } from "@/lib/reclaimAudit";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return NextResponse.json({
    service: "reclaim",
    status: "ok",
    razorpayConfigured:
      razorpayConfigured(),
    auditEvents:
      getAuditEvents().length,
    timestamp:
      new Date().toISOString(),
  });
}