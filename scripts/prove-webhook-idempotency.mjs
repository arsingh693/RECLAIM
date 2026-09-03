import crypto from "node:crypto";
import fs from "node:fs";

function readEnv(name) {
  const path = ".env.local";

  if (!fs.existsSync(path)) {
    throw new Error(
      ".env.local was not found.",
    );
  }

  const line = fs
    .readFileSync(path, "utf8")
    .split(/\r?\n/)
    .find(
      (entry) =>
        entry.startsWith(`${name}=`),
    );

  if (!line) {
    throw new Error(
      `${name} is missing from .env.local`,
    );
  }

  return line
    .slice(name.length + 1)
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

const paymentId =
  process.argv[2];

const endpoint =
  process.argv[3] ??
  "http://localhost:3000/api/razorpay/webhook";

if (!paymentId) {
  console.error(
    "Usage: node scripts/prove-webhook-idempotency.mjs <paymentId> [endpoint]",
  );
  process.exit(1);
}

const secret = readEnv(
  "RAZORPAY_WEBHOOK_SECRET",
);

const eventId =
  `reclaim-proof-${Date.now()}`;

const payload = JSON.stringify({
  entity: "event",
  event: "payment.failed",
  created_at: Math.floor(
    Date.now() / 1000,
  ),
  payload: {
    payment: {
      entity: {
        id: paymentId,
        amount: 10000,
        currency: "INR",
        status: "failed",
        method: "card",
        error_code:
          "BAD_REQUEST_ERROR",
        error_reason:
          "do_not_honour",
        error_description:
          "Synthetic replay for RECLAIM idempotency proof",
      },
    },
  },
});

const signature =
  crypto
    .createHmac(
      "sha256",
      secret,
    )
    .update(payload)
    .digest("hex");

async function sendReplay(
  attempt,
) {
  const response =
    await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
        "x-razorpay-signature":
          signature,
        "x-razorpay-event-id":
          eventId,
      },
      body: payload,
    });

  const text =
    await response.text();

  console.log(
    `\nReplay ${attempt}`,
  );

  console.log(
    `HTTP ${response.status}`,
  );

  try {
    console.log(
      JSON.stringify(
        JSON.parse(text),
        null,
        2,
      ),
    );
  } catch {
    console.log(text);
  }

  return {
    status: response.status,
    body: text,
  };
}

console.log(
  "\nRECLAIM WEBHOOK IDEMPOTENCY PROOF",
);

console.log(
  "=================================",
);

console.log(
  `Payment: ${paymentId}`,
);

console.log(
  `Event ID: ${eventId}`,
);

console.log(
  `Endpoint: ${endpoint}`,
);

const first =
  await sendReplay(1);

const second =
  await sendReplay(2);

console.log(
  "\nAssertion",
);

try {
  const firstBody =
    JSON.parse(first.body);

  const secondBody =
    JSON.parse(second.body);

  const passed =
    first.status === 200 &&
    second.status === 200 &&
    secondBody.duplicate === true &&
    secondBody.status ===
      "already_processed";

  if (!passed) {
    throw new Error(
      "Idempotency assertion failed.",
    );
  }

  console.log(
    "PASS: second delivery was deduplicated.",
  );
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Idempotency assertion failed.",
  );

  process.exit(1);
}