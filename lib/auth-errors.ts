// What went wrong in a failed sign-in, in words a person can act on.
//
// The Auth0 SDK hands lib/auth0.ts's onCallback an SdkError. Its `code` says
// where the flow broke; for errors GitHub or Auth0 reported, the provider's
// own `error` code sits on `cause.code`. Their `message` and descriptions can
// carry reflected query input, so only these fixed kinds reach the page.

export const AUTH_ERROR_KINDS = ["denied", "expired", "invite", "signin"] as const;
export type AuthErrorKind = (typeof AUTH_ERROR_KINDS)[number];

type ErrorLike = { code?: unknown; message?: unknown; cause?: unknown } | null | undefined;

/** Classify an Auth0 callback error. Unknown shapes fall back to "signin". */
export function authErrorKind(error: ErrorLike): AuthErrorKind {
  const code = typeof error?.code === "string" ? error.code : "";
  // The login tab sat open past the transaction cookie, or was replayed.
  if (code === "missing_state" || code === "invalid_state" || code === "session_expired") return "expired";
  const cause = (error?.cause ?? null) as ErrorLike;
  if (code === "authorization_error" && cause?.code === "access_denied") {
    // An Auth0 Action refusing an account without an invite also arrives as
    // access_denied; its description is the only thing that tells them apart.
    return typeof cause.message === "string" && /invit/i.test(cause.message) ? "invite" : "denied";
  }
  return "signin";
}

/** The `error` query value on /login, narrowed to a known kind. */
export function parseAuthErrorKind(value: string | undefined): AuthErrorKind | null {
  return (AUTH_ERROR_KINDS as readonly string[]).includes(value ?? "") ? value as AuthErrorKind : null;
}

export const AUTH_ERROR_COPY: Record<AuthErrorKind, { title: string; body: string }> = {
  denied: {
    title: "GitHub access wasn't granted",
    body: "The sign-in was cancelled on GitHub, so opensrcer didn't get access to your account. Nothing was saved. You can try again whenever you're ready.",
  },
  expired: {
    title: "That sign-in link expired",
    body: "The sign-in page was open too long, or it was opened from an old tab. Start a fresh sign-in and it will go through.",
  },
  invite: {
    title: "This account isn't invited yet",
    body: "opensrcer is open to invited GitHub accounts while it's in preview. Ask for early access, or sign in with the account your invite went to.",
  },
  signin: {
    title: "Sign-in didn't complete",
    body: "Something interrupted the sign-in, often blocked cookies or a network hiccup. Please try again.",
  },
};
