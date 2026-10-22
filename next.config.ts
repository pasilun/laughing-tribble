import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ['three'],
  serverExternalPackages: ['ifc-converter', '@resvg/resvg-js', 'pdfkit', 'svg-to-pdfkit'],
  // Fonts read at runtime by the plan PNG renderer.
  outputFileTracingIncludes: {
    '/api/plans/**': ['./lib/plan/fonts/**'],
    '/api/mcp': ['./lib/plan/fonts/**'],
  },
};

export default nextConfig;
