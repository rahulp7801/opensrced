export function siteUrl(): string {
  const configured = process.env.APP_BASE_URL ?? process.env.AUTH0_BASE_URL;
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  const candidate = configured ?? (vercelHost ? `https://${vercelHost}` : "http://localhost:3000");
  try {
    return new URL(candidate).origin;
  } catch {
    return "http://localhost:3000";
  }
}
