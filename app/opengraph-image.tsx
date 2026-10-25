import { ImageResponse } from "next/og";
import { o } from "@/components/brand/doodle-data";

// The card shown when an opensrcer link is shared. Rendered once at build
// time (no request data), in the brand palette (components/brand/README.md):
// blush ground, warm ink, the cobalt "o" ring, one headline. The renderer's
// built-in sans stands in for the display face. Twitter falls back to it too.
export const alt = "opensrcer: Issues in. Pull requests out.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 96px", background: "#f6e9e0", color: "#1c1714" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <svg width="46" height="46" viewBox={o.viewBox} fill="none" stroke="#2338e6" strokeLinecap="round">
            {o.strokes[0].segs.map((seg) => (
              <path key={seg.w} d={seg.d} strokeWidth={seg.w} />
            ))}
          </svg>
          <div style={{ fontSize: 46, fontWeight: 800, letterSpacing: -1.5 }}>pensrcer</div>
        </div>
        <div style={{ marginTop: 48, fontSize: 104, fontWeight: 800, lineHeight: 0.95, letterSpacing: -3, textTransform: "uppercase", display: "flex", flexDirection: "column" }}>
          <span>Issues in.</span>
          <span style={{ display: "flex", gap: 26 }}>
            Pull requests <span style={{ color: "#2338e6" }}>out.</span>
          </span>
        </div>
        <div style={{ marginTop: 40, fontSize: 32, color: "#5e524a", maxWidth: 920, lineHeight: 1.35 }}>
          Find an open issue, let an agent work through the code, and review every line before a draft pull request opens.
        </div>
      </div>
    ),
    size,
  );
}
