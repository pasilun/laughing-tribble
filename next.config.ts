import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ['three'],
  serverExternalPackages: ['ifc-converter', '@resvg/resvg-js'],
};

export default nextConfig;
