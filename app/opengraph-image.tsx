import { ImageResponse } from "next/og";

// The card shown when an opensrcer link is shared. Rendered once at build
// time (no request data), in the landing page's look: grey ground, the mark,
// one headline. Twitter falls back to this image too.
export const alt = "opensrcer: Issues in. Pull requests out.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 96px", background: "#f5f5f7", color: "#1d1d1f" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="56" height="56" viewBox="0 0 32 32">
            <rect x="2" y="2" width="28" height="28" rx="8" fill="#1d1d1f" />
            <path d="M12 9v14" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M12 18c0-4 2-6 8-6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" fill="none" />
            <circle cx="21" cy="12" r="2.6" fill="#fff" />
          </svg>
          <div style={{ fontSize: 40, fontWeight: 600, letterSpacing: -1 }}>opensrcer</div>
        </div>
        <div style={{ marginTop: 48, fontSize: 96, fontWeight: 700, lineHeight: 1.02, letterSpacing: -4, display: "flex", flexDirection: "column" }}>
          <span>Issues in.</span>
          <span>Pull requests out.</span>
        </div>
        <div style={{ marginTop: 36, fontSize: 32, color: "#636366", maxWidth: 900, lineHeight: 1.35 }}>
          Find an open issue, let an agent work through the code, and review every line before a draft pull request opens.
        </div>
      </div>
    ),
    size,
  );
}
