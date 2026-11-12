import type { NextConfig } from "next";

const PDFJS = ['./node_modules/pdfjs-dist/legacy/build/**', './node_modules/pdfjs-dist/standard_fonts/**', './node_modules/pdfjs-dist/cmaps/**']

const nextConfig: NextConfig = {
  serverExternalPackages: ['@napi-rs/canvas', 'sharp', 'pdfjs-dist', '@resvg/resvg-js', 'pdfkit', 'svg-to-pdfkit', '@sentry/node'],
  // Fonts read at runtime by the plan PNG renderer. pdf.js loads its worker module and the standard
  // font files by path at runtime, so the file tracing cannot see them: a PDF upload fails without them.
  outputFileTracingIncludes: {
    '/api/plans/**': ['./lib/plan/fonts/**', ...PDFJS],
    '/api/mcp': ['./lib/plan/fonts/**', './sites/**', ...PDFJS],
    '/api/connector': ['./lib/plan/fonts/**', './sites/**', ...PDFJS],
    '/api/sites/**': ['./lib/plan/fonts/**', './sites/**'],
    '/api/sites': ['./sites/**'],
    '/api/health': ['./lib/plan/fonts/**'],
  },
};

export default nextConfig;
