import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cosmora OS",
  description: "Адаптивная рабочая среда автономных ИИ-агентов"
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#080b12",
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
