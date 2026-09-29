import type { MetadataRoute } from "next";
import { brand } from "@cm/config";

export default function manifest(): MetadataRoute.Manifest {
  const b = brand();
  return {
    name: b.name,
    short_name: b.name,
    description: b.tagline,
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#282472",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
