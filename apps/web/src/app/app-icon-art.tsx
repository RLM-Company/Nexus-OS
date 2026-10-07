import { KOSMORA_APP_ICON_SVG } from "./kosmora-icon.generated";

const source = `data:image/svg+xml;base64,${Buffer.from(KOSMORA_APP_ICON_SVG).toString("base64")}`;

export function KosmoraIconArt({ size = 512 }: { size?: number }) {
  return <img src={source} width={size} height={size} alt="" />;
}
