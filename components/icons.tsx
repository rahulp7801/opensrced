// Compact line icons. 16px, currentColor, 1.25 stroke.

export type IconProps = React.SVGProps<SVGSVGElement> & { size?: number };

function Base({
  size = 16,
  children,
  className,
  ...rest
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconOverview = (p: IconProps) => (
  <Base {...p}>
    <rect x="2" y="2" width="5" height="5" />
    <rect x="9" y="2" width="5" height="5" />
    <rect x="2" y="9" width="5" height="5" />
    <rect x="9" y="9" width="5" height="5" />
  </Base>
);

export const IconPrs = (p: IconProps) => (
  <Base {...p}>
    <path d="M5 3.5v9" />
    <circle cx="5" cy="3.5" r="1.5" />
    <circle cx="5" cy="12.5" r="1.5" />
    <circle cx="11" cy="6" r="1.5" />
    <path d="M11 7.5v3.5a1.5 1.5 0 0 1-1.5 1.5H7" />
  </Base>
);

export const IconRepos = (p: IconProps) => (
  <Base {...p}>
    <path d="M2.5 3.5h10a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5H4a1.5 1.5 0 0 1 0-3h9" />
    <path d="M4 3.5V10" />
  </Base>
);

export const IconRuns = (p: IconProps) => (
  <Base {...p}>
    <path d="M2 8h3l2-5 2 10 2-5h3" />
  </Base>
);

export const IconTrigger = (p: IconProps) => (
  <Base {...p}>
    <path d="M9 2 3 9h4l-1 5 6-7H8l1-5z" />
  </Base>
);

export const IconSearch = (p: IconProps) => (
  <Base {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m13.5 13.5-3-3" />
  </Base>
);

export const IconArrow = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 8h10m-3.5-3.5L13 8l-3.5 3.5" />
  </Base>
);

export const IconExternal = (p: IconProps) => (
  <Base {...p}>
    <path d="M9 2h5v5" />
    <path d="M14 2 8 8" />
    <path d="M12 9v3.5A1.5 1.5 0 0 1 10.5 14h-7A1.5 1.5 0 0 1 2 12.5v-7A1.5 1.5 0 0 1 3.5 4H7" />
  </Base>
);

export const IconCopy = (p: IconProps) => (
  <Base {...p}>
    <rect x="5" y="5" width="9" height="9" rx="1" />
    <path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" />
  </Base>
);

export const IconCommand = (p: IconProps) => (
  <Base {...p}>
    <path d="M5 2a1.5 1.5 0 0 0 0 3h1.5V3.5A1.5 1.5 0 0 0 5 2zM11 2a1.5 1.5 0 0 1 0 3H9.5V3.5A1.5 1.5 0 0 1 11 2zM5 14a1.5 1.5 0 0 1 0-3h1.5v1.5A1.5 1.5 0 0 1 5 14zM11 14a1.5 1.5 0 0 0 0-3H9.5v1.5A1.5 1.5 0 0 0 11 14z" />
    <path d="M6.5 5h3v6h-3z" />
  </Base>
);

export const IconPulse = (p: IconProps) => (
  <Base {...p}>
    <path d="M1.5 8h3L6 4l2 8 2-6 1 2h3.5" />
  </Base>
);

export const IconFilter = (p: IconProps) => (
  <Base {...p}>
    <path d="M2 3h12l-4.5 6v4l-3 1.5V9L2 3z" />
  </Base>
);

export const IconShield = (p: IconProps) => (
  <Base {...p}>
    <path d="M8 1.5L2.5 4v4c0 3.5 2.3 6.1 5.5 7 3.2-.9 5.5-3.5 5.5-7V4L8 1.5z" />
    <path d="M6 8l1.5 1.5L10 6.5" />
  </Base>
);
