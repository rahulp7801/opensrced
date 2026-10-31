"use client";

// First-run onboarding (app/welcome/page.tsx): connect your AI, languages and
// interests, experience, then on to recommended issues. Every step can be
// skipped, and so can the whole thing; either way onboarding is marked done
// (PATCH /api/me) so it isn't shown again after the next sign-in.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiKeysForm } from "@/app/crucible/api-keys-form";
import { EXPERIENCE_LABELS, EXPERIENCE_LEVELS, INTERESTS, LANGUAGES, type Experience, type OnboardingAnswers } from "@/lib/onboarding";
import { readJson, requestErrorMessage } from "@/lib/fetch-json";

const STEPS = ["Connect your AI", "Languages and interests", "Experience"] as const;
const DONE = STEPS.length;

/** GET /api/me: whether a database is there to save to, and earlier answers. */
type Me = { database: boolean; settings: { languages?: unknown; interests?: unknown; experience?: unknown } };

function toggle(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
/** Fill only what the person hasn't already picked while this loaded. */
const unlessPicked = (picked: string[], loaded: string[]) => picked.length ? picked : loaded;

export function Welcome({ skipTo }: { skipTo: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [languages, setLanguages] = useState<string[]>([]);
  const [githubLanguages, setGithubLanguages] = useState<string[]>([]);
  const [interests, setInterests] = useState<string[]>([]);
  const [experience, setExperience] = useState<Experience | null>(null);
  // null until /api/me answers; false when this deployment has no database.
  const [canSave, setCanSave] = useState<boolean | null>(null);
  // Which steps were answered rather than skipped: skipped ones send nothing.
  const [answered, setAnswered] = useState({ topics: false, experience: false });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Earlier answers (when redone from /account), else languages from the
  // repositories the user has opened pull requests to: the same list the
  // Repositories page shows (app/api/repos/github).
  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]);
    const me = fetch("/api/me", { signal }).then((res) => readJson<Me>(res)).catch(() => null);
    const github = fetch("/api/repos/github?tab=contributed&per_page=30", { signal })
      .then((res) => readJson<{ repos: Array<{ language: string }> }>(res))
      .then(({ repos }) => [...new Set(repos.map((repo) => repo.language).filter(Boolean))])
      // No GitHub languages (no token, or GitHub is slow): the chips still work.
      .catch(() => [] as string[]);
    void Promise.all([me, github]).then(([account, found]) => {
      if (controller.signal.aborted) return;
      setCanSave(account?.database ?? false);
      setGithubLanguages(found);
      const saved = account?.settings ?? {};
      const savedLanguages = strings(saved.languages);
      setLanguages((picked) => unlessPicked(picked, savedLanguages.length ? savedLanguages : found));
      setInterests((picked) => unlessPicked(picked, strings(saved.interests)));
      const savedExperience = EXPERIENCE_LEVELS.find((level) => level === saved.experience);
      if (savedExperience) setExperience((picked) => picked ?? savedExperience);
    });
    return () => controller.abort();
  }, []);

  async function save(answers: OnboardingAnswers): Promise<boolean> {
    if (canSave === false) return true;
    setBusy(true);
    setProblem(null);
    try {
      await readJson(await fetch("/api/me", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(answers) }));
      return true;
    } catch (error) {
      setProblem(requestErrorMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function finish(skipExperience: boolean) {
    const done = { ...answered, experience: !skipExperience };
    setAnswered(done);
    const answers: OnboardingAnswers = {};
    if (done.topics) Object.assign(answers, { languages, interests });
    if (done.experience && experience) answers.experience = experience;
    if (await save(answers)) setStep(DONE);
  }

  async function skipAll() {
    // Still marks onboarding done; a failed save shouldn't trap anyone here.
    await save({});
    router.push(skipTo);
  }

  const languageChoices = [...new Set([...githubLanguages, ...LANGUAGES, ...languages])];

  return (
    <div className="mx-auto w-full max-w-[880px] px-5 py-10 sm:px-8">
      <header className="mb-8 pt-2 sm:pt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 font-mono text-[12px] tracking-[0.02em] text-paper-faint">
          <span>{step < DONE ? `welcome / step ${step + 1} of ${STEPS.length}` : "welcome / all set"}</span>
          {step < DONE && (
            <button type="button" onClick={skipAll} disabled={busy} className="text-link font-sans text-[14px]">Skip setup</button>
          )}
        </div>
        <h1 className="display text-[40px] leading-[1.02] tracking-[-0.02em] text-paper sm:text-[44px]" style={{ fontWeight: 700 }}>
          {step < DONE ? STEPS[step] : "You're all set"}
        </h1>
        <ol aria-label="Setup steps" className="mt-5 flex gap-2">
          {STEPS.map((title, index) => (
            <li key={title} aria-current={index === step ? "step" : undefined} className={`h-1 flex-1 rounded-full ${index <= step ? "bg-paper" : "bg-surface-3"}`}>
              <span className="sr-only">{title}{index < step ? " (done)" : ""}</span>
            </li>
          ))}
        </ol>
      </header>

      {canSave === false && step < DONE && (
        <p className="callout mb-6 text-[14px]" data-tone="info">Your choices can&apos;t be saved on this deployment yet, so this setup is for orientation only.</p>
      )}

      {step === 0 && (
        <section aria-label="Connect your AI">
          <p className="mb-6 max-w-[60ch] text-[16px] leading-[1.6] text-paper-muted">Runs use an AI you already have. Pick one now, or later from Settings: browsing and choosing issues works without it.</p>
          <ApiKeysForm />
          <StepActions onNext={() => setStep(1)} onSkip={() => setStep(1)} busy={busy} />
        </section>
      )}

      {step === 1 && (
        <section aria-label="Languages and interests">
          <p className="mb-6 max-w-[60ch] text-[16px] leading-[1.6] text-paper-muted">
            Pick what you&apos;d like to work in.{githubLanguages.length > 0 && " We pre-selected the languages of repositories you've opened pull requests to."}
          </p>
          <fieldset>
            <legend className="text-[16px] font-semibold text-paper">Languages</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {languageChoices.map((language) => (
                <button key={language} type="button" className="pill" data-edge="" aria-pressed={languages.includes(language)} onClick={() => setLanguages(toggle(languages, language))}>
                  {language}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="mt-8">
            <legend className="text-[16px] font-semibold text-paper">Interests</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {INTERESTS.map((interest) => (
                <button key={interest} type="button" className="pill" data-edge="" aria-pressed={interests.includes(interest)} onClick={() => setInterests(toggle(interests, interest))}>
                  {interest}
                </button>
              ))}
            </div>
          </fieldset>
          <StepActions
            onNext={() => { setAnswered({ ...answered, topics: true }); setStep(2); }}
            onSkip={() => { setAnswered({ ...answered, topics: false }); setStep(2); }}
            busy={busy}
          />
        </section>
      )}

      {step === 2 && (
        <section aria-label="Experience">
          <p className="mb-6 max-w-[60ch] text-[16px] leading-[1.6] text-paper-muted">How much open source have you done? This only sets where suggestions start; it changes as you contribute.</p>
          <div role="radiogroup" aria-label="Experience" className="grid gap-3 sm:grid-cols-3">
            {EXPERIENCE_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={experience === level}
                onClick={() => setExperience(level)}
                className={`card p-4 text-left transition ${experience === level ? "ring-2 ring-paper" : "hover:bg-surface-2"}`}
              >
                <span className="block text-[15px] font-semibold text-paper">{EXPERIENCE_LABELS[level].title}</span>
                <span className="mt-1.5 block text-[13.5px] leading-[1.5] text-paper-muted">{EXPERIENCE_LABELS[level].note}</span>
              </button>
            ))}
          </div>
          <StepActions nextLabel="Finish" onNext={() => finish(false)} onSkip={() => finish(true)} busy={busy} nextDisabled={!experience} />
        </section>
      )}

      {step === DONE && (
        <section aria-label="Done">
          <p className="max-w-[60ch] text-[16px] leading-[1.6] text-paper-muted">Next, pick an issue. Suggestions favour beginner-friendly issues{answered.topics && languages.length ? ` in ${languages.slice(0, 3).join(", ")}` : ""}. You can change these answers any time from your account page.</p>
          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
            <a href="/issues" className="btn-primary min-h-12 px-6 text-[16px]">Show me issues</a>
            {skipTo !== "/issues" && <a href={skipTo} className="text-link text-[15px]">Back to where I was</a>}
          </div>
        </section>
      )}

      {problem && <p role="alert" className="callout callout-alert mt-6 text-[14px]">{problem} &ldquo;Skip setup&rdquo; continues without saving.</p>}
    </div>
  );
}

function StepActions({ onNext, onSkip, busy, nextLabel = "Continue", nextDisabled = false }: {
  onNext: () => void; onSkip: () => void; busy: boolean; nextLabel?: string; nextDisabled?: boolean;
}) {
  return (
    <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-border-soft pt-6">
      <button type="button" onClick={onNext} disabled={busy || nextDisabled} className="btn-primary min-h-11 px-6 text-[15px] disabled:opacity-50">{busy ? "Saving…" : nextLabel}</button>
      <button type="button" onClick={onSkip} disabled={busy} className="text-link text-[15px]">Skip this step</button>
    </div>
  );
}
