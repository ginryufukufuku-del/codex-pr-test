import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Stock Dashboard",
    short_name: "Stocks",
    start_url: "/",
    display: "standalone",
    orientation: "landscape",
    background_color: "#0f1419",
    theme_color: "#0f1419",
    icons: [{ src: "/icon", sizes: "512x512", type: "image/png" }],
  };
}
