import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/header";
import { SectionNav } from "@/components/section-nav";
import { SiteFooter } from "@/components/footer";
import { SessionGate } from "@/components/session-gate";
import { ApiKeyGate } from "@/components/api-key-gate";
import { Onboarding } from "@/components/onboarding";
import { ToastProvider } from "@/components/toast";
import { Auth0Provider } from "@auth0/nextjs-auth0";
import { siteUrl } from "@/lib/site-url";
import { inviteOnly as inviteOnlyMode } from "@/lib/access";

// The type system (components/brand/README.md). All three are open-licence
// (OFL) and self-hosted by next/font at build time.
// - Bricolage Grotesque: headlines. Its width axis lets display type run
//   condensed (font-stretch 75-100%), and its optical-size axis gives the big
//   sizes their quirky ink-trapped cut automatically.
// - Instrument Sans: everything readable; tight and quiet.
// - JetBrains Mono: code, logs, identifiers.
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["wdth", "opsz"],
  variable: "--font-display-next",
  display: "swap",
});

const sans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-sans-next",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-next",
  display: "swap",
});

const title = "opensrcer | Review your next contribution";
const description = "Find an issue, explore the code, and review an AI-generated patch before opening a pull request.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: title, template: "%s · opensrcer" },
  description,
  applicationName: "opensrcer",
  openGraph: { type: "website", title, description },
  twitter: { card: "summary_large_image", title, description },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light",
  themeColor: "#f6e9e0", // --color-ink
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const localMode = process.env.AUTH_DISABLED === "1" && process.env.NODE_ENV !== "production";
  const inviteOnly = inviteOnlyMode();
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body
        style={
          {
            // Bind next/font CSS vars to the theme vars used in globals.css
            "--font-display": `var(--font-display-next), "Arial Narrow", sans-serif`,
            "--font-sans": `var(--font-sans-next), -apple-system, "Segoe UI", sans-serif`,
            "--font-mono": `var(--font-mono-next), ui-monospace, SFMono-Regular, Menlo, monospace`,
          } as React.CSSProperties
        }
      >
        <a className="skip-link" href="#main-content">Skip to content</a>
        <Auth0Provider
          user={localMode ? { sub: "local-dev", name: "Local workspace" } : undefined}
          profileRoute={localMode ? "/api/local-profile" : undefined}
        >
          <ToastProvider>
            <div className="flex min-h-svh flex-col">
              {/* Header + section tabs pin together, so neither has to hardcode
                  the other's height. */}
              <div className="sticky top-0 z-30">
                <SiteHeader localMode={localMode} inviteOnly={inviteOnly} />
                <SectionNav localMode={localMode} />
              </div>
              <ApiKeyGate localMode={localMode} inviteOnly={inviteOnly} />
              <Onboarding localMode={localMode} inviteOnly={inviteOnly} />
              {/* A flex column, so a page that wants to fill the window can say flex-1
                  instead of guessing how tall the chrome above it is. */}
              <main id="main-content" className="flex flex-1 flex-col"><SessionGate allowAnonymous={localMode}>{children}</SessionGate></main>
              <SiteFooter inviteOnly={inviteOnly} />
            </div>
          </ToastProvider>
        </Auth0Provider>
      </body>
    </html>
  );
}
