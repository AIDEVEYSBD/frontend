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
