import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Batch runs are chunked and resumable rather than one long request, so we
  // never depend on a long-lived serverless invocation. See src/orchestrator.
  experimental: {},
};

export default nextConfig;
