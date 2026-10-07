import { COSMORA_APP_ICON_SVG } from "./cosmora-brand.generated";

const source = `data:image/svg+xml;base64,${Buffer.from(COSMORA_APP_ICON_SVG).toString("base64")}`;

export function CosmoraIconArt({ size = 512 }: { size?: number }) {
  return <img src={source} width={size} height={size} alt="" />;
}
