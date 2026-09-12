export function authConfigured(env: Record<string, string | undefined> = process.env): boolean {
  const domain = env.AUTH0_DOMAIN || env.AUTH0_ISSUER_BASE_URL;
  const appBaseUrl = env.APP_BASE_URL || env.AUTH0_BASE_URL;
  const clientAuthentication = env.AUTH0_CLIENT_SECRET || env.AUTH0_CLIENT_ASSERTION_SIGNING_KEY;
  return Boolean(env.AUTH0_SECRET && domain && appBaseUrl && env.AUTH0_CLIENT_ID && clientAuthentication);
}
