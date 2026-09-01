import type { AttemptOutcome, FailedPayment } from "../domain/types";
import type {
  ChargeRequest,
  PaymentGateway,
  ReconciliationResult,
  RecoveryLinkRequest,
  RecoveryLinkResult,
} from "./types";

interface RazorpayConfig {
  readonly keyId: string;
  readonly keySecret: string;
  readonly baseUrl?: string;
}

interface RazorpayOrderResponse {
  readonly id: string;
  readonly entity: "order";
  readonly amount: number;
  readonly amount_paid: number;
  readonly amount_due: number;
  readonly currency: string;
  readonly status: string;
}

interface RazorpayPaymentResponse {
  readonly id: string;
  readonly entity: "payment";
  readonly amount: number;
  readonly currency: string;
  readonly status: string;
  readonly order_id?: string | null;
}

/**
 * Thin REST adapter for Razorpay's current API surface.
 *
 * Important: this adapter intentionally does NOT pretend that the generic
 * Payments API can server-side charge an arbitrary customer. Razorpay's docs
 * state that Payments APIs retrieve payment details or capture an authorized
 * payment; collection is performed through products such as Checkout,
 * Orders, Payment Links, or Subscriptions. The adapter therefore exposes
 * read/reconciliation and Payment Link creation directly, while `charge`
 * fails closed rather than inventing an unsupported API call.
 */
export class RazorpayGateway implements PaymentGateway {
  readonly name = "razorpay" as const;

  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(config: RazorpayConfig) {
    if (!config.keyId || !config.keySecret) {
      throw new Error("Razorpay key_id and key_secret are required");
    }

    this.baseUrl = (config.baseUrl ?? "https://api.razorpay.com/v1").replace(/\/$/, "");
    this.authHeader = `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`;
  }

  async charge(_request: ChargeRequest): Promise<AttemptOutcome> {
    throw new Error(
      "Direct server-side charge is not supported by this adapter. Use Razorpay Checkout/Subscriptions/Payment Links for customer-authorized collection.",
    );
  }

  async reconcile({ paymentId }: { paymentId: string }): Promise<ReconciliationResult> {
    const checkedAt = new Date().toISOString();
    const response = await this.request<RazorpayPaymentResponse>(
      `/payments/${encodeURIComponent(paymentId)}`,
    );

    const status = response.status.toLowerCase();
    if (status === "captured") {
      const outcome: AttemptOutcome = {
        paymentId,
        succeeded: true,
        recoveredPaise: response.amount,
        declineCode: null,
        gatewayReference: response.id,
        attemptedAt: checkedAt,
        indeterminate: false,
      };
      return {
        paymentId,
        status: "captured",
        outcome,
        gatewayReference: response.id,
        checkedAt,
      };
    }

    return {
      paymentId,
      status: status === "failed" ? "failed" : "unknown",
      outcome: null,
      gatewayReference: response.id,
      checkedAt,
    };
  }

  async createRecoveryLink(
    request: RecoveryLinkRequest,
  ): Promise<RecoveryLinkResult> {
    const payload = {
      amount: request.amountPaise,
      currency: "INR",
      reference_id: request.referenceId,
      description: request.description,
    };

    const response = await this.request<{
      id: string;
      short_url?: string;
    }>("/payment_links", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    return {
      paymentId: request.payment.id,
      supported: Boolean(response.short_url),
      url: response.short_url ?? null,
      gatewayReference: response.id,
      reason: response.short_url ? null : "Razorpay did not return a hosted payment-link URL",
    };
  }

  /** Creates an Order as the provider-native primitive for a new checkout flow. */
  async createOrder(
    payment: FailedPayment,
    amountPaise: number = payment.amountPaise,
  ): Promise<RazorpayOrderResponse> {
    if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
      throw new Error("Order amount must be a positive integer number of paise");
    }

    return this.request<RazorpayOrderResponse>("/orders", {
      method: "POST",
      body: JSON.stringify({
        amount: amountPaise,
        currency: "INR",
        receipt: payment.id.slice(0, 40),
        notes: {
          reclaim_payment_id: payment.id,
          merchant_id: payment.merchantId,
        },
      }),
    });
  }

  private async request<T>(
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });

    const raw = await response.text();
    let body: unknown = null;
    if (raw) {
      try {
        body = JSON.parse(raw) as unknown;
      } catch {
        body = raw;
      }
    }

    if (!response.ok) {
      throw new Error(
        `Razorpay API ${response.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`,
      );
    }

    return body as T;
  }
}
