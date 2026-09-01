import { NextResponse } from "next/server";

import type {
  FailedPayment,
  DeclineCode,
  PaymentMethod,
} from "../../../../src/domain/types";

import {
  createSimulatedPaymentGateway,
} from "../../../../src/gateway/simulatedGateway";

import {
  StubAIProvider,
} from "../../../../src/ai/stubProvider";

import {
  runRecovery,
} from "../../../../src/orchestration/recoveryRunner";

const DEMO_SCENARIOS: Record<
  string,
  {
    readonly declineCode: DeclineCode;
    readonly amountPaise: number;
    readonly method: PaymentMethod;
    readonly availableMethods: readonly PaymentMethod[];
    readonly historicalPaydayHint: number | null;
    readonly customerId: string;
    readonly customerLabel: string;
  }
> = {
  insufficient_funds: {
    declineCode:
      "INSUFFICIENT_FUNDS",
    amountPaise: 49900,
    method: "card",
    availableMethods: [
      "card",
      "upi",
    ],
    historicalPaydayHint: 1,
    customerId:
      "demo_customer_funds",
    customerLabel:
      "Returning customer · 14 successful charges",
  },

  issuer_unavailable: {
    declineCode:
      "ISSUER_UNAVAILABLE",
    amountPaise: 249900,
    method: "card",
    availableMethods: [
      "card",
      "upi",
    ],
    historicalPaydayHint: null,
    customerId:
      "demo_customer_issuer",
    customerLabel:
      "Returning customer · issuer temporarily unavailable",
  },

  gateway_timeout: {
    declineCode:
      "GATEWAY_TIMEOUT",
    amountPaise: 79900,
    method: "card",
    availableMethods: [
      "card",
      "upi",
    ],
    historicalPaydayHint: null,
    customerId:
      "demo_customer_timeout",
    customerLabel:
      "Unknown gateway state · reconciliation required",
  },

  risk_blocked: {
    declineCode:
      "RISK_BLOCKED",
    amountPaise: 159900,
    method: "card",
    availableMethods: [
      "card",
      "upi",
    ],
    historicalPaydayHint: null,
    customerId:
      "demo_customer_risk",
    customerLabel:
      "Risk engine intervention · automation restricted",
  },

  mandate_limit: {
    declineCode:
      "MANDATE_LIMIT_EXCEEDED",
    amountPaise: 99900,
    method: "card",
    availableMethods: [
      "card",
      "upi",
    ],
    historicalPaydayHint: null,
    customerId:
      "demo_customer_mandate",
    customerLabel:
      "Subscription renewal · mandate ceiling applies",
  },
};

function buildDemoPayment(
  scenario: NonNullable<
    (typeof DEMO_SCENARIOS)[string]
  >,
): FailedPayment {
  return {
    id: `pay_demo_${scenario.declineCode.toLowerCase()}`,
    merchantId:
      "merchant_reclaim_demo",
    chargeKind:
      scenario.declineCode ===
      "MANDATE_LIMIT_EXCEEDED"
        ? "subscription_renewal"
        : "one_time",
    amountPaise:
      scenario.amountPaise,
    currency: "INR",
    method: scenario.method,
    declineCode:
      scenario.declineCode,
    gatewayRawReason:
      `Deterministic demo failure: ${scenario.declineCode}`,
    failedAt:
      "2026-08-31T04:00:00.000Z",
    attemptsSoFar: 0,
    customer: {
      customerId:
        scenario.customerId,
      successfulChargesLifetime: 14,
      consecutiveFailures: 1,
      availableMethods:
        scenario.availableMethods,
      historicalPaydayHint:
        scenario.historicalPaydayHint,
      contactOptOut: false,
      hasOpenDispute: false,
      timezone: "Asia/Kolkata",
    },
    mandateCeilingPaise:
      scenario.declineCode ===
      "MANDATE_LIMIT_EXCEEDED"
        ? 50000
        : null,
  };
}

function serialiseResult(
  payment: FailedPayment,
  result: Awaited<
    ReturnType<typeof runRecovery>
  >,
) {
  return {
    payment,
    finalPayment:
      result.finalPayment,
    outcomes:
      result.outcomes,
    decisionsMade:
      result.decisionsMade,
    guardrailBlocks:
      result.guardrailBlocks,
    aiFallbacks:
      result.aiFallbacks,
    humanEscalations:
      result.humanEscalations,
    stopReason:
      result.stopReason,
    auditTrail:
      result.auditTrail,
  };
}

export async function POST(
  request: Request,
): Promise<Response> {
  try {
    const body =
      (await request.json()) as {
        scenario?: string;
      };

    const scenarioKey =
      body.scenario ??
      "insufficient_funds";

    const scenario =
      DEMO_SCENARIOS[
        scenarioKey
      ];

    if (!scenario) {
      return NextResponse.json(
        {
          error:
            `Unknown demo scenario: ${scenarioKey}`,
        },
        {
          status: 400,
        },
      );
    }

    const payment =
      buildDemoPayment(
        scenario,
      );

    const gateway =
      createSimulatedPaymentGateway(
        {
          seed:
            `reclaim-demo-${scenarioKey}`,
        },
      );

    /**
     * The simulator has an internal development-only registration
     * capability. The public PaymentGateway interface intentionally
     * remains narrower.
     */
    const simulator =
      gateway as typeof gateway & {
        registerPayment?: (
          payment: FailedPayment,
        ) => void;
      };

    simulator.registerPayment?.(
      payment,
    );

    const aiProvider =
      new StubAIProvider();

    const result =
      await runRecovery(
        payment,
        {
          gateway,
          aiProvider,
          maxTransitions: 8,
        },
      );

    return NextResponse.json(
      {
        scenario:
          scenarioKey,
        customerLabel:
          scenario.customerLabel,
        result:
          serialiseResult(
            payment,
            result,
          ),
      },
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown recovery-demo error";

    console.error(
      "Recovery demo failed:",
      error,
    );

    return NextResponse.json(
      {
        error: message,
      },
      {
        status: 500,
      },
    );
  }
}
