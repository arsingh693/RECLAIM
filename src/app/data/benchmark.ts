export interface BenchmarkMetric {
  readonly label: string;
  readonly baseline: string;
  readonly reclaim: string;
  readonly improvement: string;
}

export const BENCHMARK_SEED =
  "reclaim-demo";

export const BENCHMARK_PAYMENT_COUNT =
  100;

export const BENCHMARK = {
  baseline: {
    recoveryRate: 0.155,
    recoveredPaise: 9128500,
    attempts: 117,
  },

  reclaim: {
    recoveryRate: 0.1851,
    recoveredPaise: 10902950,
    attempts: 83,
  },

  improvement: {
    recoveryRatePercent: 19.44,
    recoveredDifferencePaise: 1774450,
    attemptDifference: -34,
  },
} as const;

export const BENCHMARK_METRICS: readonly BenchmarkMetric[] =
  [
    {
      label: "Recovery rate",
      baseline: "15.50%",
      reclaim: "18.51%",
      improvement: "+19.44%",
    },
    {
      label: "Recovered",
      baseline: "₹91,285.00",
      reclaim: "₹1,09,029.50",
      improvement: "+₹17,744.50",
    },
    {
      label: "Charge attempts",
      baseline: "117",
      reclaim: "83",
      improvement: "−34",
    },
  ] as const;