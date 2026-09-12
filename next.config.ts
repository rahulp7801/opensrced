import type { NextConfig } from "next";

const scriptSource = process.env.NODE_ENV === "production"
  ? "script-src 'self' 'unsafe-inline'"
  : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

// outputFileTracingExcludes used to carve ./ContribAI/** out of the build
// trace — 61k LOC of Rust and Python the app never imported, vendored into
// the repo and excluded again at build time. The directory is gone (see
// README → Deterministic dispatch), so the exclusion has nothing to exclude.
const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "Content-Security-Policy", value: `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; frame-src 'self'; ${scriptSource}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://avatars.githubusercontent.com; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; form-action 'self' https://*.auth0.com; media-src 'none'; manifest-src 'self'; upgrade-insecure-requests` },
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
