import { ImageResponse } from "next/og";

// The card shown when the product tour is shared, in the same look as the
// site's card (app/opengraph-image.tsx): grey ground, the mark, one headline,
// plus the tour's acts so the link says what it leads to.
export const alt = "opensrcer product tour: watch an issue become a pull request";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ACTS = ["Find", "Fix", "Ship", "Teams", "Trust"];

export default function TourOpenGraphImage() {
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
          <div style={{ marginLeft: 8, fontSize: 26, fontWeight: 600, color: "#0056ad", border: "2px solid #8fbbe8", borderRadius: 999, padding: "4px 18px" }}>Product tour</div>
        </div>
        <div style={{ marginTop: 44, fontSize: 84, fontWeight: 700, lineHeight: 1.04, letterSpacing: -3.5, display: "flex", flexDirection: "column" }}>
          <span>Watch an issue become</span>
          <span>a pull request.</span>
        </div>
        <div style={{ marginTop: 30, fontSize: 30, color: "#636366", maxWidth: 960, lineHeight: 1.35 }}>
          A guided tour built around a real run. Watch it, or click through it yourself.
        </div>
        <div style={{ marginTop: 40, display: "flex", alignItems: "center", gap: 14 }}>
          {ACTS.map((act, i) => (
            <div key={act} style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ fontSize: 24, fontWeight: 600, color: "#ffffff", background: i === 1 ? "#0056ad" : "#1d1d1f", borderRadius: 999, padding: "8px 22px" }}>{act}</div>
              {i < ACTS.length - 1 && <div style={{ fontSize: 26, color: "#a1a1a6" }}>→</div>}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
