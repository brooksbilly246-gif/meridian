import sharp from "sharp";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const svg = readFileSync(join(root, "public/icons/icon.svg"));

// Maskable icons need extra padding (safe zone is inner 80%)
const maskableSvg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <rect width="512" height="512" fill="#050505"/>
    <g transform="translate(256,256) scale(0.7)">
      <polyline points="-140,80 -60,20 20,-30 100,-90" fill="none" stroke="#10b981" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="100" cy="-90" r="14" fill="#10b981"/>
      <circle cx="100" cy="-90" r="22" fill="#10b981" opacity="0.2"/>
    </g>
  </svg>`
);

const out = join(root, "public/icons");

await Promise.all([
  sharp(svg).resize(192, 192).png().toFile(join(out, "icon-192.png")),
  sharp(svg).resize(512, 512).png().toFile(join(out, "icon-512.png")),
  sharp(maskableSvg).resize(192, 192).png().toFile(join(out, "icon-maskable-192.png")),
  sharp(maskableSvg).resize(512, 512).png().toFile(join(out, "icon-maskable-512.png")),
  sharp(svg).resize(180, 180).png().toFile(join(out, "apple-touch-icon.png")),
]);

console.log("Icons generated.");
