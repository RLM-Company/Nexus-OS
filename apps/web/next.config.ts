import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    const apiOrigin = process.env.COSMORA_API_ORIGIN ?? "http://127.0.0.1:3100";
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  }
};

export default nextConfig;
