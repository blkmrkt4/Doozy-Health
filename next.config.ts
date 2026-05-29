import type { NextConfig } from "next";

// PWA (Serwist) is deliberately deferred to build-sequence step 17.
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

export default nextConfig;
