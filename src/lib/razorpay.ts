const RAZORPAY_BASE_URL =
  "https://api.razorpay.com/v1";

function getRazorpayAuthHeader(): string {
  const keyId =
    process.env.RAZORPAY_KEY_ID;

  const keySecret =
    process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error(
      "Razorpay credentials are not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env.local.",
    );
  }

  return `Basic ${Buffer.from(
    `${keyId}:${keySecret}`,
  ).toString("base64")}`;
}

export async function razorpayRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(
    `${RAZORPAY_BASE_URL}${path}`,
    {
      ...init,
      headers: {
        Authorization:
          getRazorpayAuthHeader(),
        "Content-Type":
          "application/json",
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    },
  );

  const raw =
    await response.text();

  let body: unknown = null;

  if (raw) {
    try {
      body =
        JSON.parse(raw) as unknown;
    } catch {
      body = raw;
    }
  }

  if (!response.ok) {
    throw new Error(
      `Razorpay API ${response.status}: ${
        typeof body === "string"
          ? body
          : JSON.stringify(body)
      }`,
    );
  }

  return body as T;
}

export function razorpayConfigured(): boolean {
  return Boolean(
    process.env.RAZORPAY_KEY_ID &&
      process.env.RAZORPAY_KEY_SECRET,
  );
}