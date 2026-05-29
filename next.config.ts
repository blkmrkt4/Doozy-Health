import type { NextConfig } from "next";

// PWA (Serwist) is deliberately deferred to build-sequence step 17; this
// config stays minimal until then. Document uploads (step 5) will reinstate
// the serverActions body-size limit to match the 25 MB documents-bucket cap.
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
