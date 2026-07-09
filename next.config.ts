import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  turbopack: {},
  serverExternalPackages: ['onnxruntime-node'],
};

export default nextConfig;