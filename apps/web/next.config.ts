import type { NextConfig } from "next";

const LOOPBACK_API_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

const localApiOrigin = (): string => {
  const configured = process.env.COSMORA_API_ORIGIN ?? "http://127.0.0.1:3100";

  let origin: URL;
  try {
    origin = new URL(configured);
  } catch {
    throw new Error("COSMORA_API_ORIGIN must be a loopback HTTP origin");
  }

  if (
    origin.protocol !== "http:" ||
    !LOOPBACK_API_HOSTS.has(origin.hostname) ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== ""
  ) {
    throw new Error("COSMORA_API_ORIGIN must be a loopback HTTP origin");
  }

  return origin.origin;
};

const nextConfig: NextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    const apiOrigin = localApiOrigin();
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  }
};

export default nextConfig;
