import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ['three'],
  serverExternalPackages: ['ifc-converter'],
};

export default nextConfig;
