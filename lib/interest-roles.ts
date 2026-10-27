// The /join form's Role choices, shared by the form (client) and lib/interest.ts (server).
export const INTEREST_ROLES = ["Student", "Contributor", "Maintainer", "Other"] as const;
export type InterestRole = (typeof INTEREST_ROLES)[number];
