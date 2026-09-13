import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Cosmora Manager Console",
    short_name: "Cosmora",
    description: "Проекты, диалоги с Менеджером и безопасный контроль Cosmora.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#212121",
    theme_color: "#212121",
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
        name: "Новый проект",
        short_name: "Новый проект",
        description: "Открыть новую задачу для Cosmora Manager",
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
