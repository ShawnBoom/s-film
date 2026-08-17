import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "S Film",
    short_name: "S Film",
    description: "在手机本地为照片添加胶片质感。",
    start_url: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f2efe7",
    theme_color: "#f2efe7",
  };
}
