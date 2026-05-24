import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ['@thatopen/components', '@thatopen/fragments', 'three', 'camera-controls'],
};

export default nextConfig;
