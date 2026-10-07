import { ImageResponse } from "next/og";
import { CosmoraIconArt } from "./app-icon-art";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<CosmoraIconArt size={size.width} />, { ...size });
}
