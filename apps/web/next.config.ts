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
  // @cosmora/contracts is a TS source workspace whose barrel re-exports
  // modules as "./x.js" while only "./x.ts" exists on disk. Production and
  // tsx resolve that through TS `moduleResolution: bundler`; the dev webpack
  // resolver needs the same alias. Keep it scoped to dev so production keeps
  // Next's default resolution.
  webpack(config, { dev }) {
    if (dev) {
      config.resolve.extensionAlias = {
        ...config.resolve.extensionAlias,
        ".js": [".ts", ".tsx", ".js", ".jsx"]
      };
    }
    return config;
  },

  async rewrites() {
    const apiOrigin = localApiOrigin();
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  }
};

export default nextConfig;
