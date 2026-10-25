import { ImageResponse } from "next/og";
import { o } from "@/components/brand/doodle-data";

// Home-screen icon for iOS. Same mark as app/icon.svg (the wordmark's cobalt
// "o" ring on blush); iOS rounds the corners itself, so the tile fills the canvas.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#f6e9e0" }}>
        <svg width="124" height="124" viewBox={o.viewBox} fill="none" stroke="#2338e6" strokeLinecap="round">
          {o.strokes[0].segs.map((seg) => (
            <path key={seg.w} d={seg.d} strokeWidth={seg.w} />
          ))}
        </svg>
      </div>
    ),
    size,
  );
}
