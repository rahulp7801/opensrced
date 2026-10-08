import { ImageResponse } from "next/og";

// Home-screen icon for iOS. Same mark as app/icon.svg; iOS rounds the corners
// itself, so the tile fills the canvas.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#1d1d1f" }}>
        <svg width="120" height="120" viewBox="4 4 24 24">
          <path d="M12 9v14" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M12 18c0-4 2-6 8-6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" fill="none" />
          <circle cx="21" cy="12" r="2.6" fill="#fff" />
        </svg>
      </div>
    ),
    size,
  );
}
