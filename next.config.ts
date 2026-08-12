import type { NextConfig } from "next";

// outputFileTracingExcludes used to carve ./ContribAI/** out of the build
// trace — 61k LOC of Rust and Python the app never imported, vendored into
// the repo and excluded again at build time. The directory is gone (see
// README → Deterministic dispatch), so the exclusion has nothing to exclude.
const config: NextConfig = {
  reactStrictMode: true,
};

export default config;
