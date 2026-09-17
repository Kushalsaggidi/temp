import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  async redirects() {
    return [
      { source: "/catalog", destination: "/marketplace", permanent: false },
      { source: "/discover", destination: "/discovery", permanent: false },
      { source: "/admin/governance", destination: "/governance", permanent: false },
      {
        source: "/admin/governance/:assetVersionId",
        destination: "/governance/:assetVersionId",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
