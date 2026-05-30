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
  experimental: {
    // Photo/PDF uploads run through server actions; allow up to the 25 MB
    // documents-bucket cap (PRD §5.1; matches the documents migration).
    serverActions: {
      bodySizeLimit: "26mb",
    },
  },
};

export default withSerwist(nextConfig);
