import { generateSeedBatch } from "../src/data/seedBatch";

import {
  createSimulatedPaymentGateway,
} from "../src/gateway/simulatedGateway";

import { StubAIProvider } from "../src/ai/stubProvider";

import { orchestratePayment } from "../src/orchestration/orchestrator";

async function main(): Promise<void> {
  const batch = generateSeedBatch({
    seed: "ai-smoke-test",
    size: 5,
  });

  const gateway =
    createSimulatedPaymentGateway({
      seed: "ai-smoke-test",
      baseDate: "2026-08-31T04:30:00.000Z",
    });

  const aiProvider = new StubAIProvider();

  let fallbackCount = 0;
  let executedCount = 0;

  for (const payment of batch.payments) {
    const result =
      await orchestratePayment(
        payment,
        gateway,
        aiProvider,
      );

    if (result.aiFallbackUsed) {
      fallbackCount += 1;
    }

    if (result.executed) {
      executedCount += 1;
    }

    console.log("");
    console.log(`Payment: ${payment.id}`);
    console.log(`Decline: ${payment.declineCode}`);
    console.log(`AI source: ${result.decision.source}`);
    console.log(`AI confidence: ${result.aiConfidence}`);
    console.log(
      `Selected intervention: ${result.decision.intervention}`,
    );
    console.log(
      `Fallback used: ${result.aiFallbackUsed}`,
    );
    console.log(
      `Guardrail allowed: ${result.guardrail.allowed}`,
    );
    console.log(`Executed: ${result.executed}`);
    console.log(
      `Recovered: ${result.outcome?.recoveredPaise ?? 0} paise`,
    );
  }

  console.log("");
  console.log(
    "✓ AI orchestration smoke test completed",
  );
  console.log(
    `✓ payments tested: ${batch.payments.length}`,
  );
  console.log(
    `✓ AI fallbacks: ${fallbackCount}`,
  );
  console.log(
    `✓ executions: ${executedCount}`,
  );
}

main().catch((error) => {
  console.error(
    "✗ AI orchestration smoke test failed",
  );
  console.error(error);
  process.exitCode = 1;
});