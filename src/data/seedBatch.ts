/**
 * Deterministic benchmark batch generator for RECLAIM.
 *
 * The benchmark must be reproducible:
 *
 *     same seed + same configuration
 *             ↓
 *        same payment batch
 *
 * This allows the baseline and RECLAIM agent to be evaluated
 * against exactly the same population.
 *
 * IMPORTANT:
 * The generator creates realistic decision CONTEXT.
 * It does not embed the "correct" intervention for each payment.
 * The recovery policy must determine that later.
 */

import type {
  ChargeKind,
  CustomerContext,
  DeclineCode,
  FailedPayment,
  PaymentMethod,
} from "../domain/types";

import { getDeclineProfile } from "../domain/declineCodes";

export interface SeedBatch {
  readonly seed: string;
  readonly baseDate: string;
  readonly version: 1;
  readonly payments: readonly FailedPayment[];
}

export interface SeedBatchOptions {
  readonly seed?: string;
  readonly size?: number;

  /**
   * Fixed benchmark clock.
   *
   * Keeping this explicit makes the benchmark reproducible.
   */
  readonly baseDate?: string;
}

export const SEED_BATCH_DEFAULTS: Required<SeedBatchOptions> = {
  seed: "reclaim-demo-001",
  size: 400,
  baseDate: "2026-08-31T04:30:00.000Z",
};

const RAW_REASONS: Record<
  DeclineCode,
  readonly string[]
> = {
  INSUFFICIENT_FUNDS: [
    "insufficient balance",
    "insufficient funds",
    "available balance too low",
  ],

  CARD_EXPIRED: [
    "card expired",
    "expired card",
    "expiry date invalid",
  ],

  CARD_BLOCKED: [
    "card blocked",
    "card reported lost",
    "issuer blocked instrument",
  ],

  ISSUER_UNAVAILABLE: [
    "issuer temporarily unavailable",
    "bank service unavailable",
    "issuer timeout",
  ],

  GATEWAY_TIMEOUT: [
    "gateway response timeout",
    "upstream response unavailable",
    "request timed out before final outcome",
  ],

  LIMIT_EXCEEDED: [
    "transaction limit exceeded",
    "daily limit exceeded",
    "instrument limit exceeded",
  ],

  DO_NOT_HONOUR: [
    "do not honour",
    "issuer declined without reason",
    "generic issuer decline",
  ],

  AUTHENTICATION_FAILED: [
    "3ds authentication failed",
    "cvv validation failed",
    "otp authentication failed",
  ],

  MANDATE_PAUSED: [
    "mandate paused",
    "recurring debit paused",
    "mandate inactive",
  ],

  MANDATE_LIMIT_EXCEEDED: [
    "mandate amount limit exceeded",
    "recurring amount exceeds mandate ceiling",
    "mandate cap exceeded",
  ],

  RISK_BLOCKED: [
    "risk engine blocked transaction",
    "suspected fraud",
    "risk policy decline",
  ],

  INVALID_INSTRUMENT: [
    "invalid payment instrument",
    "invalid account details",
    "instrument unavailable",
  ],
};

/**
 * Small deterministic 32-bit hash.
 *
 * We intentionally avoid Math.random() so the benchmark remains
 * stable across runs and machines.
 */
function hash32(input: string): number {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

/**
 * Deterministic value in [0, 1).
 */
function unit(input: string): number {
  return hash32(input) / 4294967296;
}

/**
 * Deterministic integer in [min, max], inclusive.
 */
function intBetween(
  seed: string,
  min: number,
  max: number,
): number {
  if (max < min) {
    throw new Error(
      `Invalid integer range: ${min}..${max}`,
    );
  }

  return (
    min +
    Math.floor(
      unit(seed) * (max - min + 1),
    )
  );
}

/**
 * Deterministically select one item.
 */
function pick<T>(
  seed: string,
  values: readonly T[],
): T {
  if (values.length === 0) {
    throw new Error(
      "Cannot pick from an empty list",
    );
  }

  return values[
    Math.floor(unit(seed) * values.length)
  ]!;
}

/**
 * Deterministically select according to weights.
 */
function weightedPick<T>(
  seed: string,
  values: readonly {
    readonly value: T;
    readonly weight: number;
  }[],
): T {
  if (values.length === 0) {
    throw new Error(
      "Cannot select from an empty weighted list",
    );
  }

  const totalWeight = values.reduce(
    (sum, item) => sum + item.weight,
    0,
  );

  if (totalWeight <= 0) {
    throw new Error(
      "Weighted choices must have positive total weight",
    );
  }

  let cursor =
    unit(seed) * totalWeight;

  for (const item of values) {
    cursor -= item.weight;

    if (cursor < 0) {
      return item.value;
    }
  }

  return values[values.length - 1]!.value;
}

/**
 * Convert "minutes before benchmark clock" into
 * an ISO timestamp.
 */
function isoFromMinutes(
  baseDate: string,
  minutesBeforeBase: number,
): string {
  const baseTimestamp =
    Date.parse(baseDate);

  if (!Number.isFinite(baseTimestamp)) {
    throw new Error(
      `Invalid benchmark base date: ${baseDate}`,
    );
  }

  return new Date(
    baseTimestamp -
      minutesBeforeBase * 60_000,
  ).toISOString();
}

/**
 * Choose realistic payment amounts in paise.
 *
 * We deliberately use common-looking merchant amounts
 * mixed with a smaller number of larger invoices/payments.
 */
function chooseAmountPaise(
  seed: string,
): number {
  return weightedPick(seed, [
    { value: 19900, weight: 12 },     // ₹199
    { value: 49900, weight: 18 },     // ₹499
    { value: 79900, weight: 12 },     // ₹799
    { value: 99900, weight: 12 },     // ₹999
    { value: 149900, weight: 14 },    // ₹1,499
    { value: 249900, weight: 10 },    // ₹2,499
    { value: 499900, weight: 9 },     // ₹4,999
    { value: 999900, weight: 6 },     // ₹9,999
    { value: 2499900, weight: 4 },    // ₹24,999
    { value: 4999900, weight: 2 },    // ₹49,999
    { value: 9999900, weight: 1 },    // ₹99,999
  ]);
}

/**
 * Deliberately imbalanced decline distribution.
 *
 * This is a synthetic benchmark distribution, not a claim
 * about Razorpay's real-world production traffic.
 */
function chooseDeclineCode(
  seed: string,
): DeclineCode {
  return weightedPick(seed, [
    {
      value: "INSUFFICIENT_FUNDS",
      weight: 24,
    },
    {
      value: "ISSUER_UNAVAILABLE",
      weight: 11,
    },
    {
      value: "DO_NOT_HONOUR",
      weight: 12,
    },
    {
      value: "CARD_EXPIRED",
      weight: 8,
    },
    {
      value: "CARD_BLOCKED",
      weight: 5,
    },
    {
      value: "AUTHENTICATION_FAILED",
      weight: 8,
    },
    {
      value: "LIMIT_EXCEEDED",
      weight: 7,
    },
    {
      value: "GATEWAY_TIMEOUT",
      weight: 7,
    },
    {
      value: "MANDATE_PAUSED",
      weight: 4,
    },
    {
      value: "MANDATE_LIMIT_EXCEEDED",
      weight: 5,
    },
    {
      value: "RISK_BLOCKED",
      weight: 4,
    },
    {
      value: "INVALID_INSTRUMENT",
      weight: 5,
    },
  ]);
}

/**
 * Pick why the payment exists.
 */
function chooseChargeKind(
  seed: string,
): ChargeKind {
  return weightedPick(seed, [
    {
      value: "one_time",
      weight: 53,
    },
    {
      value: "subscription_renewal",
      weight: 32,
    },
    {
      value: "invoice",
      weight: 15,
    },
  ]);
}

/**
 * Subscription renewals are more likely to use recurring
 * payment methods, while one-time charges are more mixed.
 */
function choosePrimaryMethod(
  seed: string,
  chargeKind: ChargeKind,
): PaymentMethod {
  if (
    chargeKind ===
    "subscription_renewal"
  ) {
    return weightedPick(seed, [
      {
        value: "card",
        weight: 35,
      },
      {
        value: "emandate",
        weight: 35,
      },
      {
        value: "upi",
        weight: 20,
      },
      {
        value: "netbanking",
        weight: 7,
      },
      {
        value: "wallet",
        weight: 3,
      },
    ]);
  }

  return weightedPick(seed, [
    {
      value: "card",
      weight: 48,
    },
    {
      value: "upi",
      weight: 28,
    },
    {
      value: "netbanking",
      weight: 12,
    },
    {
      value: "wallet",
      weight: 9,
    },
    {
      value: "emandate",
      weight: 3,
    },
  ]);
}

/**
 * Build alternate payment rails available to the customer.
 *
 * The primary method is always included.
 */
function buildAvailableMethods(
  seed: string,
  primaryMethod: PaymentMethod,
  chargeKind: ChargeKind,
): PaymentMethod[] {
  const methods: PaymentMethod[] = [
    primaryMethod,
  ];

  const alternateCount =
    intBetween(
      `${seed}:alternate-count`,
      0,
      2,
    );

  const preferredAlternates =
    chargeKind ===
    "subscription_renewal"
      ? ([
          "upi",
          "card",
          "netbanking",
          "emandate",
          "wallet",
        ] as const)
      : ([
          "upi",
          "card",
          "netbanking",
          "wallet",
          "emandate",
        ] as const);

  for (
    let offset = 0;
    offset <
      preferredAlternates.length &&
      methods.length <
        alternateCount + 1;
    offset += 1
  ) {
    const candidate =
      preferredAlternates[offset]!;

    if (
      candidate !== primaryMethod
    ) {
      methods.push(candidate);
    }
  }

  return methods;
}

/**
 * Build synthetic customer context.
 *
 * Note that the customer ID is part of CustomerContext because
 * that is the canonical domain model.
 */
function buildCustomerContext(
  seed: string,
  chargeKind: ChargeKind,
  primaryMethod: PaymentMethod,
  declineCode: DeclineCode,
): CustomerContext {
  const customerId =
    `customer_${intBetween(
      `${seed}:customer-id`,
      1,
      100,
    )}`;

  const successfulChargesLifetime =
    intBetween(
      `${seed}:successful`,
      0,
      120,
    );

  const consecutiveFailures =
    intBetween(
      `${seed}:failures`,
      0,
      4,
    );

  const contactOptOut =
    unit(`${seed}:optout`) < 0.06;

  const paydayHint =
    unit(`${seed}:payday`) < 0.58
      ? intBetween(
          `${seed}:payday-day`,
          1,
          28,
        )
      : null;

  const availableMethods =
    buildAvailableMethods(
      `${seed}:methods`,
      primaryMethod,
      chargeKind,
    );

  const hasOpenDispute =
    unit(`${seed}:dispute`) < 0.08;

  /**
   * Risk-blocked payments are deliberately given an open
   * dispute context in this synthetic benchmark so that the
   * hard-stop path appears in the dataset.
   *
   * This is a benchmark design choice, not a claim about
   * real-world payment behaviour.
   */
  if (
    declineCode === "RISK_BLOCKED"
  ) {
    return {
      customerId,
      successfulChargesLifetime,
      consecutiveFailures,
      availableMethods,
      historicalPaydayHint: paydayHint,
      contactOptOut,
      hasOpenDispute: true,
      timezone: "Asia/Kolkata",
    };
  }

  return {
    customerId,
    successfulChargesLifetime,
    consecutiveFailures,
    availableMethods,
    historicalPaydayHint: paydayHint,
    contactOptOut,
    hasOpenDispute,
    timezone: "Asia/Kolkata",
  };
}

/**
 * Choose the mandate ceiling.
 *
 * Domain rule:
 *
 * one_time
 *     → mandate information not applicable
 *
 * subscription_renewal
 *     → mandate information required
 *
 * invoice
 *     → mandate information may or may not exist
 */
function chooseMandateCeiling(
  seed: string,
  chargeKind: ChargeKind,
  amountPaise: number,
): number | null {
  if (
    chargeKind === "one_time"
  ) {
    return null;
  }

  /**
   * Subscription renewals must always have
   * mandate information.
   *
   * Importantly, some ceilings are intentionally
   * below the requested amount. Those cases are useful
   * for testing MANDATE_LIMIT_EXCEEDED and split/re-auth
   * behaviour later.
   */
  if (
    chargeKind ===
    "subscription_renewal"
  ) {
    const ratio =
      [
        0.4,
        0.6,
        0.8,
        1,
        1.5,
        2,
      ][
        intBetween(
          `${seed}:subscription-ceiling-ratio`,
          0,
          5,
        )
      ]!;

    return Math.round(
      amountPaise * ratio,
    );
  }

  /**
   * Invoices can optionally carry a mandate ceiling.
   */
  const shouldHaveCeiling =
    unit(
      `${seed}:invoice-ceiling-present`,
    ) < 0.8;

  if (!shouldHaveCeiling) {
    return null;
  }

  const ratio =
    [
      0.4,
      0.6,
      0.8,
      1,
      1.5,
      2,
    ][
      intBetween(
        `${seed}:invoice-ceiling-ratio`,
        0,
        5,
      )
    ]!;

  return Math.round(
    amountPaise * ratio,
  );
}

/**
 * Choose previous attempts while respecting the
 * domain's maximum charge-attempt policy.
 *
 * We leave room for the recovery engine to take
 * future actions.
 */
function chooseAttemptCount(
  seed: string,
  declineCode: DeclineCode,
): number {
  const profile =
    getDeclineProfile(
      declineCode,
    );

  const maxAttempts = Math.max(
    0,
    profile.maxChargeAttempts,
  );

  if (maxAttempts === 0) {
    return 0;
  }

  return intBetween(
    `${seed}:attempts`,
    0,
    Math.min(
      2,
      maxAttempts - 1,
    ),
  );
}

/**
 * Construct one failed-payment record.
 */
function buildPayment(
  seed: string,
  index: number,
  baseDate: string,
): FailedPayment {
  const paymentSeed =
    `${seed}:payment:${index}`;

  const chargeKind =
    chooseChargeKind(
      `${paymentSeed}:kind`,
    );

  const amountPaise =
    chooseAmountPaise(
      `${paymentSeed}:amount`,
    );

  const declineCode =
    chooseDeclineCode(
      `${paymentSeed}:decline`,
    );

  const primaryMethod =
    choosePrimaryMethod(
      `${paymentSeed}:method`,
      chargeKind,
    );

  const customer =
    buildCustomerContext(
      `${paymentSeed}:customer`,
      chargeKind,
      primaryMethod,
      declineCode,
    );

  const mandateCeilingPaise =
    chooseMandateCeiling(
      `${paymentSeed}:mandate`,
      chargeKind,
      amountPaise,
    );

  const attemptsSoFar =
    chooseAttemptCount(
      `${paymentSeed}:attempts`,
      declineCode,
    );

  const gatewayRawReason =
    pick(
      `${paymentSeed}:reason`,
      RAW_REASONS[declineCode],
    );

  return {
    id: `pay_sim_${String(
      index + 1,
    ).padStart(4, "0")}`,

    chargeKind,

    amountPaise,

    currency: "INR",

    method: primaryMethod,

    declineCode,

    gatewayRawReason,

    failedAt:
      isoFromMinutes(
        baseDate,
        intBetween(
          `${paymentSeed}:age`,
          5,
          60 * 72,
        ),
      ),

    attemptsSoFar,

    customer,

    mandateCeilingPaise,

    merchantId:
      `merchant_${intBetween(
        `${paymentSeed}:merchant`,
        1,
        20,
      )}`,
  };
}

/**
 * Generate a complete deterministic benchmark batch.
 */
export function generateSeedBatch(
  options: SeedBatchOptions = {},
): SeedBatch {
  const seed =
    options.seed ??
    SEED_BATCH_DEFAULTS.seed;

  const size =
    options.size ??
    SEED_BATCH_DEFAULTS.size;

  const baseDate =
    options.baseDate ??
    SEED_BATCH_DEFAULTS.baseDate;

  if (
    !Number.isInteger(size) ||
    size <= 0
  ) {
    throw new Error(
      "Seed batch size must be a positive integer",
    );
  }

  if (
    !Number.isFinite(
      Date.parse(baseDate),
    )
  ) {
    throw new Error(
      `Invalid benchmark base date: ${baseDate}`,
    );
  }

  const payments =
    Array.from(
      { length: size },
      (_, index) =>
        buildPayment(
          seed,
          index,
          baseDate,
        ),
    );

  const batch: SeedBatch = {
    seed,
    baseDate,
    version: 1,
    payments,
  };

  validateSeedBatch(batch);

  return batch;
}

/**
 * Validate structural/domain invariants of the generated batch.
 *
 * This intentionally validates the benchmark independently
 * of the future AI policy.
 */
export function validateSeedBatch(
  batch: SeedBatch,
): void {
  if (
    batch.version !== 1
  ) {
    throw new Error(
      `Unsupported seed batch version: ${batch.version}`,
    );
  }

  if (
    batch.payments.length === 0
  ) {
    throw new Error(
      "Seed batch cannot be empty",
    );
  }

  if (
    !batch.seed.trim()
  ) {
    throw new Error(
      "Seed must not be empty",
    );
  }

  if (
    !Number.isFinite(
      Date.parse(batch.baseDate),
    )
  ) {
    throw new Error(
      `Invalid batch base date: ${batch.baseDate}`,
    );
  }

  const seenPaymentIds =
    new Set<string>();

  const seenCustomerIds =
    new Set<string>();

  for (
    const payment of batch.payments
  ) {
    /**
     * Payment ID uniqueness.
     */
    if (
      seenPaymentIds.has(
        payment.id,
      )
    ) {
      throw new Error(
        `Duplicate payment ID: ${payment.id}`,
      );
    }

    seenPaymentIds.add(
      payment.id,
    );

    /**
     * Payment amount validity.
     */
    if (
      !Number.isSafeInteger(
        payment.amountPaise,
      ) ||
      payment.amountPaise <= 0
    ) {
      throw new Error(
        `${payment.id}: amount must be a positive integer number of paise`,
      );
    }

    /**
     * Currency is fixed for this benchmark.
     */
    if (
      payment.currency !== "INR"
    ) {
      throw new Error(
        `${payment.id}: benchmark currency must be INR`,
      );
    }

    /**
     * Primary method must actually be available
     * in the customer's method set.
     */
    if (
      !payment.customer.availableMethods.includes(
        payment.method,
      )
    ) {
      throw new Error(
        `${payment.id}: primary payment method must be available`,
      );
    }

    /**
     * Customer IDs must exist.
     */
    if (
      !payment.customer.customerId.trim()
    ) {
      throw new Error(
        `${payment.id}: customer ID cannot be empty`,
      );
    }

    seenCustomerIds.add(
      payment.customer.customerId,
    );

    /**
     * Historical successful charges and failures
     * must be non-negative integers.
     */
    if (
      !Number.isInteger(
        payment.customer
          .successfulChargesLifetime,
      ) ||
      payment.customer
        .successfulChargesLifetime < 0
    ) {
      throw new Error(
        `${payment.id}: invalid successful-charge history`,
      );
    }

    if (
      !Number.isInteger(
        payment.customer
          .consecutiveFailures,
      ) ||
      payment.customer
        .consecutiveFailures < 0
    ) {
      throw new Error(
        `${payment.id}: invalid consecutive-failure count`,
      );
    }

    /**
     * Alternate method set cannot be empty.
     */
    if (
      payment.customer
        .availableMethods.length === 0
    ) {
      throw new Error(
        `${payment.id}: customer must have at least one payment method`,
      );
    }

    /**
     * Historical payday, when present, must
     * represent a valid day of month.
     */
    if (
      payment.customer
        .historicalPaydayHint !== null &&
      (
        !Number.isInteger(
          payment.customer
            .historicalPaydayHint,
        ) ||
        payment.customer
          .historicalPaydayHint < 1 ||
        payment.customer
          .historicalPaydayHint > 28
      )
    ) {
      throw new Error(
        `${payment.id}: invalid historical payday hint`,
      );
    }

    /**
     * Previous attempts must be a non-negative
     * integer and must respect the decline policy ceiling.
     */
    if (
      !Number.isInteger(
        payment.attemptsSoFar,
      ) ||
      payment.attemptsSoFar < 0
    ) {
      throw new Error(
        `${payment.id}: invalid attempt count`,
      );
    }

    const profile =
      getDeclineProfile(
        payment.declineCode,
      );

    if (
      payment.attemptsSoFar >
      profile.maxChargeAttempts
    ) {
      throw new Error(
        `${payment.id}: previous attempts exceed policy ceiling`,
      );
    }

    /**
     * Subscription renewals must always
     * contain mandate information.
     */
    if (
      payment.chargeKind ===
        "subscription_renewal" &&
      payment.mandateCeilingPaise === null
    ) {
      throw new Error(
        `${payment.id}: subscription renewal must have mandate information`,
      );
    }

    /**
     * One-time payments do not carry
     * a mandate ceiling.
     */
    if (
      payment.chargeKind ===
        "one_time" &&
      payment.mandateCeilingPaise !== null
    ) {
      throw new Error(
        `${payment.id}: one-time payment must not have mandate information`,
      );
    }

    /**
     * Mandate ceiling, when present, must
     * be a positive integer amount in paise.
     */
    if (
      payment.mandateCeilingPaise !== null &&
      (
        !Number.isSafeInteger(
          payment.mandateCeilingPaise,
        ) ||
        payment.mandateCeilingPaise <= 0
      )
    ) {
      throw new Error(
        `${payment.id}: invalid mandate ceiling`,
      );
    }

    /**
     * Failed timestamp must be valid.
     */
    if (
      !Number.isFinite(
        Date.parse(
          payment.failedAt,
        ),
      )
    ) {
      throw new Error(
        `${payment.id}: failedAt must be a valid ISO timestamp`,
      );
    }

    /**
     * Raw gateway reason must exist.
     */
    if (
      !payment.gatewayRawReason.trim()
    ) {
      throw new Error(
        `${payment.id}: raw gateway reason cannot be empty`,
      );
    }

    /**
     * Merchant identity must exist.
     */
    if (
      !payment.merchantId.trim()
    ) {
      throw new Error(
        `${payment.id}: merchant ID cannot be empty`,
      );
    }

    /**
     * An opted-out customer must not be
     * combined with a future customer-contact
     * decision here. The actual intervention
     * constraint is enforced later by the guardrails.
     *
     * We intentionally do not make the seed generator
     * decide recovery behaviour.
     */
  }

  /**
   * We want at least some customer reuse in the
   * benchmark so customer history can matter.
   *
   * With 400 payments / 100 customers, this should
   * naturally be true. If the generator ever changes,
   * catch that regression here.
   */
  if (
    seenCustomerIds.size >=
    batch.payments.length
  ) {
    throw new Error(
      "Benchmark unexpectedly contains no repeated customers",
    );
  }
}