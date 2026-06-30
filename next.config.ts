import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  serverExternalPackages: ['z-ai-web-dev-sdk'],
  allowedDevOrigins: ['*'],
};

export default nextConfig;