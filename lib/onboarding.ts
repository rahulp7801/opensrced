// First-run onboarding's choices and the validation of its answers. No
// database imports: components/welcome.tsx renders these lists in the
// browser. Saving them is lib/users.ts completeOnboarding().

export const EXPERIENCE_LEVELS = ["new", "some", "regular"] as const;
export type Experience = (typeof EXPERIENCE_LEVELS)[number];

export const EXPERIENCE_LABELS: Record<Experience, { title: string; note: string }> = {
  new: { title: "I've never contributed", note: "We'll start with small, well-described issues and explain each step." },
  some: { title: "A few pull requests", note: "You know the flow; we'll suggest issues with a bit more to them." },
  regular: { title: "I contribute regularly", note: "Skip the basics and go straight to issues that fit your languages." },
};

/** Offered as chips; the user's own GitHub languages are added to these. */
export const LANGUAGES = ["Python", "JavaScript", "TypeScript", "Go", "Rust", "Java", "C", "C++", "C#", "Ruby", "PHP", "Kotlin", "Swift"] as const;

export const INTERESTS = [
  "Bug fixes", "Documentation", "Tests", "Web frontends", "Backends and APIs",
  "Command-line tools", "Data and ML", "DevOps and CI", "Accessibility", "Performance",
] as const;

/** Same shape the recommendations API accepts for a language. */
const LANGUAGE = /^[\w+#. -]{1,40}$/;
const MAX_CHOICES = 30;

export type OnboardingAnswers = { languages?: string[]; interests?: string[]; experience?: Experience };

export class OnboardingInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnboardingInputError";
  }
}

/** Trimmed, de-duplicated (case-insensitively, first spelling kept). */
function stringList(value: unknown, field: string, accept: (item: string) => boolean): string[] {
  if (!Array.isArray(value) || value.length > MAX_CHOICES) throw new OnboardingInputError(`${field} must be a list of at most ${MAX_CHOICES} items.`);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const text = typeof item === "string" ? item.trim() : "";
    if (!accept(text)) throw new OnboardingInputError(`${field} has an invalid item.`);
    if (seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push(text);
  }
  return out;
}

/** Validate the body of PATCH /api/me. Every field is optional (a skipped
 *  step sends nothing, and {} skips onboarding); anything else is refused
 *  rather than stored. */
export function parseOnboarding(body: unknown): OnboardingAnswers {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new OnboardingInputError("Expected a JSON object.");
  const input = body as Record<string, unknown>;
  const unknown = Object.keys(input).filter((key) => !["languages", "interests", "experience"].includes(key));
  if (unknown.length) throw new OnboardingInputError(`Unknown field: ${unknown[0].slice(0, 40)}.`);
  const answers: OnboardingAnswers = {};
  if (input.languages !== undefined) answers.languages = stringList(input.languages, "languages", (item) => LANGUAGE.test(item));
  if (input.interests !== undefined) answers.interests = stringList(input.interests, "interests", (item) => (INTERESTS as readonly string[]).includes(item));
  if (input.experience !== undefined) {
    if (!(EXPERIENCE_LEVELS as readonly unknown[]).includes(input.experience)) throw new OnboardingInputError("experience must be new, some or regular.");
    answers.experience = input.experience as Experience;
  }
  return answers;
}
