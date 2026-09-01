import type { AttemptOutcome, FailedPayment, PaymentMethod } from "../domain/types";

export type GatewayPaymentStatus =
  | "pending"
  | "captured"
  | "failed"
  | "unknown";

export interface ChargeRequest {
  readonly paymentId: string;
  readonly amountPaise: number;
  readonly currency: "INR";
  readonly method: PaymentMethod;
  readonly attemptNumber: number;
  /** Stable key used to make an execution idempotent. */
  readonly idempotencyKey: string;
}

export interface ReconcileRequest {
  readonly paymentId: string;
}

export interface ReconciliationResult {
  readonly paymentId: string;
  readonly status: GatewayPaymentStatus;
  readonly outcome: AttemptOutcome | null;
  readonly gatewayReference: string | null;
  readonly checkedAt: string;
}

export interface RecoveryLinkRequest {
  readonly payment: FailedPayment;
  readonly amountPaise: number;
  readonly description: string;
  readonly referenceId: string;
}

export interface RecoveryLinkResult {
  readonly paymentId: string;
  readonly supported: boolean;
  readonly url: string | null;
  readonly gatewayReference: string | null;
  readonly reason: string | null;
}

/**
 * The gateway boundary used by the recovery engine.
 *
 * The simulator can execute a synthetic charge directly. A real Razorpay
 * integration must respect the actual product/API boundary: server-side
 * Payments APIs retrieve/capture existing payments, while customer-facing
 * collection can be initiated with Orders/Checkout or Payment Links. The
 * interface therefore also exposes a recovery-link primitive.
 */
export interface PaymentGateway {
  readonly name: string;
  charge(request: ChargeRequest): Promise<AttemptOutcome>;
  reconcile(request: ReconcileRequest): Promise<ReconciliationResult>;
  createRecoveryLink(request: RecoveryLinkRequest): Promise<RecoveryLinkResult>;
}
