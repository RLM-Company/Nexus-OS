import { ImageResponse } from "next/og";
import { KosmoraIconArt } from "./app-icon-art";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<KosmoraIconArt size={size.width} />, { ...size });
}
