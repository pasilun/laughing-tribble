import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@napi-rs/canvas', 'sharp', 'pdfjs-dist', '@resvg/resvg-js', 'pdfkit', 'svg-to-pdfkit'],
  // Fonts read at runtime by the plan PNG renderer.
  outputFileTracingIncludes: {
    '/api/plans/**': ['./lib/plan/fonts/**'],
    '/api/mcp': ['./lib/plan/fonts/**', './sites/**'],
    '/api/sites/**': ['./lib/plan/fonts/**', './sites/**'],
    '/api/sites': ['./sites/**'],
    '/api/health': ['./lib/plan/fonts/**'],
  },
};

export default nextConfig;
