import { spawnSync } from "node:child_process";

const checks = [
  ["TYPECHECK", "npm", ["run", "typecheck"]],
  ["BUILD", "npm", ["run", "build"]],
  ["RECOVERY VERIFY", "npm", ["run", "verify"]],
  ["SAFETY PROOF", "npm", ["run", "safety:proof"]],
];

console.log("\nRECLAIM SUBMISSION GATE");
console.log("=======================\n");

for (const [name, command, args] of checks) {
  console.log(`[RUN] ${name}`);

  const result = spawnSync(
    command,
    args,
    {
      stdio: "inherit",
      shell: true,
    },
  );

  if (result.status !== 0) {
    console.error(
      `\n[FAIL] ${name}`,
    );

    process.exit(
      result.status ?? 1,
    );
  }

  console.log(
    `[PASS] ${name}\n`,
  );
}

console.log(
  "=======================",
);

console.log(
  "ALL RECLAIM SUBMISSION CHECKS PASSED.",
);