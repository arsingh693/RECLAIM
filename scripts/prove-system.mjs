const baseUrl =
  process.env.RECLAIM_BASE_URL ??
  "http://localhost:3000";

async function check(
  label,
  path,
) {
  const response =
    await fetch(
      `${baseUrl}${path}`,
    );

  const text =
    await response.text();

  let body;

  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  console.log(
    `\n${label}`,
  );

  console.log(
    `HTTP ${response.status}`,
  );

  console.log(
    typeof body === "string"
      ? body
      : JSON.stringify(
          body,
          null,
          2,
        ),
  );

  if (!response.ok) {
    throw new Error(
      `${path} failed`,
    );
  }
}

console.log(
  "\nRECLAIM SYSTEM PROOF",
);

console.log(
  "====================",
);

await check(
  "RECLAIM HEALTH",
  "/api/reclaim/health",
);

await check(
  "RECLAIM STATUS",
  "/api/reclaim/status",
);

await check(
  "RAZORPAY HEALTH",
  "/api/razorpay/health",
);

await check(
  "AUDIT LEDGER",
  "/api/razorpay/audit",
);

console.log(
  "\nSYSTEM PROOF COMPLETE.",
);

console.log(
  "====================",
);