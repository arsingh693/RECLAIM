import { NextResponse } from "next/server";

import {
  getAuditEvents,
} from "@/lib/reclaimAudit";

export async function GET(
  request: Request,
): Promise<Response> {
  const url =
    new URL(request.url);

  const paymentId =
    url.searchParams.get(
      "paymentId",
    ) ?? undefined;

  return NextResponse.json({
    provider:
      "reclaim",
    events:
      getAuditEvents(
        paymentId,
      ),
  });
}