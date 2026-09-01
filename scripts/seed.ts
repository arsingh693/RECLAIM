import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  generateSeedBatch,
  SEED_BATCH_DEFAULTS,
  validateSeedBatch,
} from "../src/data/seedBatch";

async function main(): Promise<void> {
  const root = process.cwd();

  const outputPath = resolve(
    root,
    "data",
    "demo-batch.json",
  );

  const batch = generateSeedBatch(
    SEED_BATCH_DEFAULTS,
  );

  validateSeedBatch(batch);

  await mkdir(
    resolve(root, "data"),
    {
      recursive: true,
    },
  );

  await writeFile(
    outputPath,
    `${JSON.stringify(batch, null, 2)}\n`,
    "utf8",
  );

  const totalPaise =
    batch.payments.reduce(
      (sum, payment) =>
        sum + payment.amountPaise,
      0,
    );

  const counts = new Map<
    string,
    number
  >();

  for (const payment of batch.payments) {
    counts.set(
      payment.declineCode,
      (counts.get(payment.declineCode) ?? 0) + 1,
    );
  }

  console.log(
    `✓ seed generated — ${batch.payments.length} payments`,
  );

  console.log(
    `  seed: ${batch.seed}`,
  );

  console.log(
    `  at risk: ₹${(
      totalPaise / 100
    ).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
    })}`,
  );

  console.log(
    `  output: ${outputPath}`,
  );

  console.log("  decline mix:");

  for (const [
    code,
    count,
  ] of counts) {
    console.log(
      `    ${code}: ${count}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(
    "✗ seed generation failed",
  );

  console.error(error);

  process.exitCode = 1;
});