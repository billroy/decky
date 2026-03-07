/**
 * Generate minimal PNG icon files for the StreamDeck plugin.
 * Pure Node.js — no external image dependencies.
 *
 * Creates solid-color circles on transparent backgrounds
 * at the required @1x and @2x sizes.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

function crc32(buf) {
  let table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
}

function createPNG(width, height, renderPixel) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const ihdrChunk = pngChunk("IHDR", ihdr);

  // IDAT — raw pixel rows with filter byte
  const rowLen = 1 + width * 4; // filter byte + RGBA per pixel
  const raw = Buffer.alloc(rowLen * height);
  for (let y = 0; y < height; y++) {
    raw[y * rowLen] = 0; // no filter
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = renderPixel(x, y, width, height);
      const off = y * rowLen + 1 + x * 4;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
      raw[off + 3] = a;
    }
  }
  const idatChunk = pngChunk("IDAT", deflateSync(raw));

  // IEND
  const iendChunk = pngChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function circleRenderer(r, g, b) {
  return (x, y, w, h) => {
    const cx = w / 2, cy = h / 2, radius = w * 0.4;
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
    if (dist <= radius) return [r, g, b, 255];
    if (dist <= radius + 1.5) {
      // anti-aliased edge
      const alpha = Math.round(255 * Math.max(0, 1 - (dist - radius) / 1.5));
      return [r, g, b, alpha];
    }
    return [0, 0, 0, 0]; // transparent
  };
}

function solidRenderer(r, g, b) {
  return () => [r, g, b, 255];
}

// Ensure action icon directories exist
for (const dir of [
  "com.decky.controller.sdPlugin/imgs/actions/approve",
  "com.decky.controller.sdPlugin/imgs/actions/deny",
  "com.decky.controller.sdPlugin/imgs/actions/cancel",
  "com.decky.controller.sdPlugin/imgs/actions/slot",
]) {
  mkdirSync(dir, { recursive: true });
}

const icons = [
  // Plugin icons
  { path: "com.decky.controller.sdPlugin/imgs/plugin/icon.png", w: 256, h: 256, render: circleRenderer(100, 100, 100) },
  { path: "com.decky.controller.sdPlugin/imgs/plugin/icon@2x.png", w: 512, h: 512, render: circleRenderer(100, 100, 100) },

  // Status action icons
  { path: "com.decky.controller.sdPlugin/imgs/actions/status/icon.png", w: 20, h: 20, render: circleRenderer(100, 100, 100) },
  { path: "com.decky.controller.sdPlugin/imgs/actions/status/icon@2x.png", w: 40, h: 40, render: circleRenderer(100, 100, 100) },
  { path: "com.decky.controller.sdPlugin/imgs/actions/status/key.png", w: 72, h: 72, render: circleRenderer(100, 100, 100) },
  { path: "com.decky.controller.sdPlugin/imgs/actions/status/key@2x.png", w: 144, h: 144, render: circleRenderer(100, 100, 100) },

  // Approve action icons (green)
  { path: "com.decky.controller.sdPlugin/imgs/actions/approve/icon.png", w: 20, h: 20, render: circleRenderer(34, 197, 94) },
  { path: "com.decky.controller.sdPlugin/imgs/actions/approve/icon@2x.png", w: 40, h: 40, render: circleRenderer(34, 197, 94) },
  { path: "com.decky.controller.sdPlugin/imgs/actions/approve/key.png", w: 72, h: 72, render: circleRenderer(34, 197, 94) },
  { path: "com.decky.controller.sdPlugin/imgs/actions/approve/key@2x.png", w: 144, h: 144, render: circleRenderer(34, 197, 94) },

  // Deny action icons (red)
  { path: "com.decky.controller.sdPlugin/imgs/actions/deny/icon.png", w: 20, h: 20, render: circleRenderer(239, 68, 68) },
  { path: "com.decky.controller.sdPlugin/imgs/actions/deny/icon@2x.png", w: 40, h: 40, render: circleRenderer(239, 68, 68) },
  { path: "com.decky.controller.sdPlugin/imgs/actions/deny/key.png", w: 72, h: 72, render: circleRenderer(239, 68, 68) },
  { path: "com.decky.controller.sdPlugin/imgs/actions/deny/key@2x.png", w: 144, h: 144, render: circleRenderer(239, 68, 68) },

  // Cancel action icons (amber)
  { path: "com.decky.controller.sdPlugin/imgs/actions/cancel/icon.png", w: 20, h: 20, render: circleRenderer(245, 158, 11) },
  { path: "com.decky.controller.sdPlugin/imgs/actions/cancel/icon@2x.png", w: 40, h: 40, render: circleRenderer(245, 158, 11) },
  { path: "com.decky.controller.sdPlugin/imgs/actions/cancel/key.png", w: 72, h: 72, render: circleRenderer(245, 158, 11) },
  { path: "com.decky.controller.sdPlugin/imgs/actions/cancel/key@2x.png", w: 144, h: 144, render: circleRenderer(245, 158, 11) },

  // Slot action icons (blue — dynamic multi-purpose button)
  { path: "com.decky.controller.sdPlugin/imgs/actions/slot/icon.png", w: 20, h: 20, render: circleRenderer(59, 130, 246) },
  { path: "com.decky.controller.sdPlugin/imgs/actions/slot/icon@2x.png", w: 40, h: 40, render: circleRenderer(59, 130, 246) },
  { path: "com.decky.controller.sdPlugin/imgs/actions/slot/key.png", w: 72, h: 72, render: circleRenderer(59, 130, 246) },
  { path: "com.decky.controller.sdPlugin/imgs/actions/slot/key@2x.png", w: 144, h: 144, render: circleRenderer(59, 130, 246) },
];

for (const { path, w, h, render } of icons) {
  const png = createPNG(w, h, render);
  writeFileSync(path, png);
  console.log(`  created ${path} (${w}x${h})`);
}

console.log("Icons generated.");
