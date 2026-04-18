import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  outputFileTracingExcludes: {
    "*": ["./ContribAI/**/*"],
  },
};

export default config;
