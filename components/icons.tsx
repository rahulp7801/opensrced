import {
  ArrowRight,
  ArrowSquareOut,
  BookOpen,
  Check,
  Copy,
  Funnel,
  GitPullRequest,
  Lightning,
  MagnifyingGlass,
  Pulse,
  ShieldCheck,
  SignOut,
  SquaresFour,
  Waveform,
  X,
  type Icon,
  type IconProps,
} from "@phosphor-icons/react";

export type { IconProps };

function appIcon(IconComponent: Icon) {
  return function AppIcon({ size = 16, ...props }: IconProps) {
    return <IconComponent aria-hidden focusable="false" size={size} weight="regular" {...props} />;
  };
}

export const IconOverview = appIcon(SquaresFour);
export const IconPrs = appIcon(GitPullRequest);
export const IconRepos = appIcon(BookOpen);
export const IconRuns = appIcon(Waveform);
export const IconTrigger = appIcon(Lightning);
export const IconSearch = appIcon(MagnifyingGlass);
export const IconArrow = appIcon(ArrowRight);
export const IconExternal = appIcon(ArrowSquareOut);
export const IconCopy = appIcon(Copy);
export const IconPulse = appIcon(Pulse);
export const IconFilter = appIcon(Funnel);
export const IconShield = appIcon(ShieldCheck);
export const IconCheck = appIcon(Check);
export const IconClose = appIcon(X);
export const IconSignOut = appIcon(SignOut);
