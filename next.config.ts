import type { NextConfig } from "next";

const scriptSource = process.env.NODE_ENV === "production"
  ? "script-src 'self' 'unsafe-inline'"
  : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

function csp(ide = false): string {
  const script = ide ? `${scriptSource} 'wasm-unsafe-eval'` : scriptSource;
  const connect = ide ? "connect-src 'self' https://raw.githubusercontent.com" : "connect-src 'self'";
  return `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; frame-src 'self'; ${script}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://avatars.githubusercontent.com; font-src 'self'; ${connect}; worker-src 'self' blob:; form-action 'self' https://*.auth0.com; media-src 'none'; manifest-src 'self'; upgrade-insecure-requests`;
}

// outputFileTracingExcludes used to carve ./ContribAI/** out of the build
// trace — 61k LOC of Rust and Python the app never imported, vendored into
// the repo and excluded again at build time. The directory is gone (see
// README → Deterministic dispatch), so the exclusion has nothing to exclude.
const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The app never uses next/image, so the optimizer endpoint (/_next/image) is
  // pure attack surface (GHSA-2464-fhr4-w9xw): unoptimized turns it off (404).
  images: { unoptimized: true },
  // PGlite (lib/db/client.ts, local dev only) loads its WASM and extension
  // bundles from its own package directory; bundling it breaks those paths.
  serverExternalPackages: ["@electric-sql/pglite", "@electric-sql/pglite-pgvector"],
  webpack(config, { isServer, webpack }) {
    // VS Code's workbench (the IDE, components/ide) imports its CSS from JS
    // and hands each file's text to registerCss, which adopts it as a
    // stylesheet. Next's global-CSS rules can't take CSS imported from
    // inside node_modules, so these files get css-loader with a string
    // export first (the setup monaco-vscode-api's README documents). The run
    // panel's xterm.css takes the same path and is added as a <style>.
    const nextRules = config.module.rules.find((rule: { oneOf?: unknown[] }) => Array.isArray(rule.oneOf));
    nextRules.oneOf.unshift({
      test: /node_modules[\\/](@codingame[\\/]monaco-vscode|vscode|monaco-editor|@xterm[\\/]xterm).*\.css$/,
      use: [{ loader: "css-loader", options: { esModule: false, exportType: "string", url: true, import: true } }],
    }, {
      // Fonts and images those stylesheets reference (the codicon font).
      test: /node_modules[\\/](@codingame[\\/]monaco-vscode|vscode|monaco-editor).*\.(ttf|woff2?|png|svg|gif)$/,
      type: "asset/resource",
    });
    // Two VS Code libraries in the IDE's workbench have Node-only branches:
    // @vscode/diff reads its WASM with `import("node:fs/promises")` and
    // @vscode/vscode-languagedetection loads its model with node-fetch (not
    // installed). The IDE only runs in the browser, which takes the fetch
    // branch, so those imports resolve to empty modules instead of failing
    // the build (the server bundle compiles the IDE too, never runs it).
    // The wrapper's view panels also bring VS Code's merge-conflict extension.
    // Its code runs through the main-thread extension host, which evaluates
    // it with new Function: the IDE's CSP has no 'unsafe-eval', so it failed
    // to activate on every load (a lesson has no merge conflicts anyway).
    config.resolve.alias = { ...config.resolve.alias, "node-fetch": false, "@codingame/monaco-vscode-merge-conflict-default-extension": false };
    if (!isServer) {
      // Next emits `new URL("./asset", import.meta.url)` as a relative URL
      // ("/_next/static/media/..."), which VS Code reads as a file:// path.
      // The workbench registers its extension files and fonts that way, so
      // the browser bundle gets absolute URLs (webpack's default).
      config.module.parser = { ...config.module.parser, javascript: { ...config.module.parser?.javascript, url: true } };
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^node:fs\/promises$/, (resource: { request: string }) => { resource.request = "fs/promises"; }));
      config.resolve.fallback = { ...config.resolve.fallback, "fs/promises": false };
    }
    return config;
  },
  async headers() {
    return [{
      // Config headers replace a route's own header of the same name, so the
      // graph viz route (repository-derived HTML) is excluded here and keeps
      // its sandboxed policy and no-referrer from lib/graph-html.ts.
      source: "/((?!api/graph/[^/]+/[^/]+/viz$).*)",
      headers: [
        { key: "Content-Security-Policy", value: csp() },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ],
    },
    // The in-browser IDE (components/ide) reads repo files from
    // raw.githubusercontent.com and runs WebAssembly (TextMate's regex engine)
    // in its workers. Workers take the CSP of their own script's response, so
    // the bundles under /_next/static get it as well. A later entry with the
    // same key replaces the one above.
    ...["/learn/:path*", "/_next/static/:path*"].map((source) => ({ source, headers: [{ key: "Content-Security-Policy", value: csp(true) }] })),
    {
      source: "/(.*)",
      headers: [
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        // Sign-in is a full redirect, never a popup, so nothing needs a
        // cross-origin window handle to this one.
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      ],
    }];
  },
};

export default config;
