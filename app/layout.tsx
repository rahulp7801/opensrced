import type { Metadata } from "next";
import { Instrument_Serif, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/header";
import { SectionNav } from "@/components/section-nav";
import { SiteFooter } from "@/components/footer";
import { ApiKeyGate } from "@/components/api-key-gate";
import { Onboarding } from "@/components/onboarding";
import { ToastProvider } from "@/components/toast";
import { Auth0Provider } from "@auth0/nextjs-auth0";

const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-serif-next",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-mono-next",
  display: "swap",
});

export const metadata: Metadata = {
  title: "opensrcer / Observatory",
  description:
    "Mission-control dashboard for the opensrcer autonomous contribution agent. Live PRs, repos, runs, and signal telemetry.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${mono.variable}`}>
      <body
        style={
          {
            // Bind next/font CSS vars to the theme vars used in globals.css
            "--font-serif": `var(--font-serif-next), "Instrument Serif", ui-serif, Georgia, serif`,
            "--font-mono": `var(--font-mono-next), ui-monospace, SFMono-Regular, Menlo, monospace`,
          } as React.CSSProperties
        }
      >
        <Auth0Provider>
          <ToastProvider>
            <div className="flex min-h-svh flex-col">
              {/* Header + section tabs pin together, so neither has to hardcode
                  the other's height. */}
              <div className="sticky top-0 z-30">
                <SiteHeader />
                <SectionNav />
              </div>
              <ApiKeyGate />
              <Onboarding />
              {/* A flex column, so a page that wants to fill the window can say flex-1
                  instead of guessing how tall the chrome above it is. */}
              <main className="flex flex-1 flex-col">{children}</main>
              <SiteFooter />
            </div>
          </ToastProvider>
        </Auth0Provider>
      </body>
    </html>
  );
}
