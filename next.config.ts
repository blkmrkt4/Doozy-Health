import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

// PWA via Serwist (PRD §6.4, §13.17). Dependency: @serwist/next + serwist
// (~50kB combined). Service worker generation + Next.js integration for
// precaching and runtime caching. Alternative: manual SW (error-prone).

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Local dev is accessed via 127.0.0.1 (matches the Supabase auth site_url);
  // allow it as a dev origin so HMR/asset requests aren't flagged cross-origin.
  allowedDevOrigins: ["127.0.0.1"],
  // Keep the serverless Chromium + Puppeteer out of the webpack bundle so Next
  // traces their real files (incl. @sparticuz/chromium's brotli binary) into
  // the function — otherwise executablePath() can't find the browser at runtime.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  experimental: {
    // Photo/PDF uploads run through server actions; allow up to the 25 MB
    // documents-bucket cap (PRD §5.1; matches the documents migration).
    serverActions: {
      bodySizeLimit: "26mb",
    },
  },
};

export default withSerwist(nextConfig);
