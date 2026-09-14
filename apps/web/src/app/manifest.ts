import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Cosmora AI",
    short_name: "Cosmora",
    description: "Обычные чаты, проекты и безопасные рабочие области Cosmora.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    lang: "ru",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
        purpose: "any"
      }
    ],
    shortcuts: [
      {
        name: "Новый чат",
        short_name: "Новый чат",
        description: "Открыть обычный чат Cosmora",
        url: "/"
      },
      {
        name: "Центр контроля",
        short_name: "Контроль",
        description: "Открыть безопасный Control Center",
        url: "/control-center"
      }
    ]
  };
}
