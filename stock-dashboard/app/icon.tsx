import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: "#0f1419", color: "#ef5350", fontSize: 300, display: "flex", alignItems: "center", justifyContent: "center" }}>
        ↗
      </div>
    ),
    size,
  );
}
