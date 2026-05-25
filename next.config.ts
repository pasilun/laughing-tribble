import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ['@thatopen/components', '@thatopen/fragments', 'three', 'camera-controls'],
  async headers() {
    return [
      {
        source: '/:path*.wasm',
        headers: [{ key: 'Content-Type', value: 'application/wasm' }],
      },
    ]
  },
};

export default nextConfig;
