import type { NextConfig } from "next";

/**
 * Split deployment: the console on Vercel, the control plane and runtime in
 * the Docker stack behind the tunnel. When RUNTIME_ORIGIN is set (Vercel
 * project setting, e.g. https://agentruntime.autogrc.cloud), every /api call
 * is proxied there server-side, so the pages need no code changes and stay
 * same-origin. Unset, the app serves its own API, as it does locally and in
 * the container.
 */
const runtimeOrigin = process.env.RUNTIME_ORIGIN?.replace(/\/+$/, "");

const nextConfig: NextConfig = {
  devIndicators: false,
  experimental: {
    // Next's proxy drops an upstream that stays silent this long (30 s by
    // default). Paths the backend owns can hold longer: a slow model call on
    // the gateway, a long-poll on the SDK door. Cloud Run's own limit is an hour.
    proxyTimeout: 3_600_000,
  },
  // The cross-encoder reranker loads ONNX Runtime natively; bundling it breaks the binary.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],
  async rewrites() {
    if (!runtimeOrigin) return [];
    return {
      beforeFiles: [{ source: "/api/:path*", destination: `${runtimeOrigin}/api/:path*` }],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
