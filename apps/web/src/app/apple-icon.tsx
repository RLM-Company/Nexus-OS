import { ImageResponse } from "next/og";
import { KosmoraIconArt } from "./app-icon-art";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<KosmoraIconArt size={size.width} />, { ...size });
}
