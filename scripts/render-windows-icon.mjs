import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// Rasterize the existing SVG mark; ICO embeds the resulting 256px PNG losslessly.
const webRequire = createRequire(resolve("apps/web/package.json"));
const nextRequire = createRequire(webRequire.resolve("next/package.json"));
const sharp = nextRequire("sharp");
const png = await sharp("desktop/windows/build/icon.svg").resize(256, 256).png().toBuffer();
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
await writeFile("desktop/windows/build/icon.ico", Buffer.concat([header, png]));
