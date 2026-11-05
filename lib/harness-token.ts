// The harness token's shape, in a module of its own: middleware.ts runs where
// lib/harness.ts (crypto, the database) can't be imported.

export const TOKEN_PREFIX = "osh_";
/** The only Authorization header middleware.ts lets through to /api/harness/*. */
export const TOKEN_HEADER = /^Bearer osh_[A-Za-z0-9_-]{32}$/;
