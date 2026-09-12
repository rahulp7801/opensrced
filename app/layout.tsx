import type { Metadata, Viewport } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/header";
import { SectionNav } from "@/components/section-nav";
import { SiteFooter } from "@/components/footer";
import { SessionGate } from "@/components/session-gate";
import { ApiKeyGate } from "@/components/api-key-gate";
import { Onboarding } from "@/components/onboarding";
import { ToastProvider } from "@/components/toast";
import { Auth0Provider } from "@auth0/nextjs-auth0";

const sans = Geist({
  subsets: ["latin"],
  variable: "--font-sans-next",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-mono-next",
  display: "swap",
});

const title = "opensrcer | Review your next contribution";
const description = "Find an issue, explore the code, and review an AI-generated patch before opening a pull request.";

export const metadata: Metadata = {
  title,
  description,
  applicationName: "opensrcer",
  openGraph: { type: "website", title, description },
  twitter: { card: "summary", title, description },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark",
  themeColor: "#101113",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body
        style={
          {
            // Bind next/font CSS vars to the theme vars used in globals.css
            "--font-sans": `var(--font-sans-next), "Segoe UI", sans-serif`,
            "--font-serif": `var(--font-sans-next), "Segoe UI", sans-serif`,
            "--font-mono": `var(--font-mono-next), ui-monospace, SFMono-Regular, Menlo, monospace`,
          } as React.CSSProperties
        }
      >
        <a className="skip-link" href="#main-content">Skip to content</a>
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
              <main id="main-content" className="flex flex-1 flex-col"><SessionGate allowAnonymous={process.env.AUTH_DISABLED === "1" && process.env.NODE_ENV !== "production"}>{children}</SessionGate></main>
              <SiteFooter />
            </div>
          </ToastProvider>
        </Auth0Provider>
      </body>
    </html>
  );
}
