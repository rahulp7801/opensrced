import type { NextConfig } from "next";

// outputFileTracingExcludes used to carve ./ContribAI/** out of the build
// trace — 61k LOC of Rust and Python the app never imported, vendored into
// the repo and excluded again at build time. The directory is gone (see
// README → Deterministic dispatch), so the exclusion has nothing to exclude.
const config: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
      ],
    }];
  },
};

export default config;
