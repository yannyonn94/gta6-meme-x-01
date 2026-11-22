// main.ts — gta6-meme-x-01 ("Post a GTA 6 meme on X").
// Generates the meme image (1024x1024 PNG) with Node 22 standard library
// only: no network, no wall clock, no files outside the repository, and
// fully deterministic — the same input always produces the same bytes.
//
// Scene: a storm-purple Vice City sunset behind the white make.fun ghost
// in sunglasses holding a gold $ coin, joking that everyone has waited
// for GTA 6 since 2013 while the agent already earns on make.fun.
//
// The PNG encoder (zlib deflate + CRC32) and the bitmap font used for all
// text are implemented in this file. No system font files are read.
//
// Usage (as the grader runs it):
//   mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts
// Writes meme.png into MAKEFUN_OUTPUT_DIR (default /output). If a
// POST.json exists in MAKEFUN_BOT_DIR (default /bot) it is copied to the
// output dir; if it is absent (bilsky has not posted yet) a note is
// printed to stderr and the run still exits 0.

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

export const WIDTH = 1024;
export const HEIGHT = 1024;

// ---------------------------------------------------------------------------
// Palette (taken from the draft scene)
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

const SKY_TOP: RGB = [43, 16, 84]; // deep purple
const SKY_MID: RGB = [190, 40, 120]; // magenta
const SKY_BOT: RGB = [255, 140, 66]; // sunset orange
const SUN_OUTER: RGB = [255, 214, 120];
const SUN_INNER: RGB = [255, 236, 170];
const CITY: RGB = [24, 8, 44]; // skyline / palm silhouette
const WINDOW_LIT: RGB = [255, 200, 90];
const GHOST_WHITE: RGB = [255, 255, 255];
const INK: RGB = [20, 6, 40]; // eyes, smile, text outline
const SHADES: RGB = [15, 15, 20];
const COIN_GOLD: RGB = [255, 200, 60];
const COIN_RING: RGB = [190, 130, 20];
const COIN_DARK: RGB = [150, 95, 10];
const TEXT_WHITE: RGB = [255, 255, 255];
const TEXT_YELLOW: RGB = [255, 220, 130];

// ---------------------------------------------------------------------------
// Canvas: a plain RGBA pixel buffer with small shape primitives
// ---------------------------------------------------------------------------

class Canvas {
  readonly w: number;
  readonly h: number;
  readonly px: Buffer; // length w * h * 4, row-major RGBA

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.px = Buffer.alloc(w * h * 4, 255); // opaque by default
  }

  set(x: number, y: number, c: RGB): void {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return;
    const o = (iy * this.w + ix) * 4;
    this.px[o] = c[0];
    this.px[o + 1] = c[1];
    this.px[o + 2] = c[2];
    this.px[o + 3] = 255;
  }

  // Filled rectangle, [x0, x1) x [y0, y1), edges clipped to the canvas.
  rect(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
    const ax = Math.max(0, Math.floor(x0));
    const ay = Math.max(0, Math.floor(y0));
    const bx = Math.min(this.w, Math.ceil(x1));
    const by = Math.min(this.h, Math.ceil(y1));
    for (let y = ay; y < by; y++) {
      let o = (y * this.w + ax) * 4;
      for (let x = ax; x < bx; x++) {
        this.px[o] = c[0];
        this.px[o + 1] = c[1];
        this.px[o + 2] = c[2];
        this.px[o + 3] = 255;
        o += 4;
      }
    }
  }

  // Filled ellipse. `half` trims it: "top" keeps y <= cy, "bottom" y >= cy,
  // "full" keeps everything. Used for the ghost dome and its wavy hem.
  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    c: RGB,
    half: "full" | "top" | "bottom" = "full",
  ): void {
    const x0 = Math.max(0, Math.floor(cx - rx));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + rx));
    const y0 = Math.max(0, Math.floor(cy - ry));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + ry));
    for (let y = y0; y <= y1; y++) {
      if (half === "top" && y > cy) continue;
      if (half === "bottom" && y < cy) continue;
      const dy = (y - cy) / ry;
      const dxMax = rx * Math.sqrt(Math.max(0, 1 - dy * dy));
      const xa = Math.max(0, Math.floor(cx - dxMax));
      const xb = Math.min(this.w - 1, Math.ceil(cx + dxMax));
      let o = (y * this.w + xa) * 4;
      for (let x = xa; x <= xb; x++) {
        this.px[o] = c[0];
        this.px[o + 1] = c[1];
        this.px[o + 2] = c[2];
        this.px[o + 3] = 255;
        o += 4;
      }
    }
  }

  circle(cx: number, cy: number, r: number, c: RGB): void {
    this.ellipse(cx, cy, r, r, c, "full");
  }

  // Thin ring (outline) of an ellipse, `thick` pixels wide, drawn inward
  // from the edge. Used for the gold coin's inner ring.
  ring(cx: number, cy: number, rx: number, ry: number, thick: number, c: RGB): void {
    const innerX = rx - thick;
    const innerY = ry - thick;
    const x0 = Math.max(0, Math.floor(cx - rx));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + rx));
    const y0 = Math.max(0, Math.floor(cy - ry));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + ry));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
        const di = ((x - cx) / innerX) ** 2 + ((y - cy) / innerY) ** 2;
        if (d <= 1 && di > 1) this.set(x, y, c);
      }
    }
  }

  // Thick line segment: stamps filled discs along the segment so joins
  // stay round. Used for palm trunks and fronds.
  thickLine(x0: number, y0: number, x1: number, y1: number, width: number, c: RGB): void {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(dist));
    const r = width / 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.ellipse(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, r, c, "full");
    }
  }

  // Arc of an ellipse from a0 to a1 (degrees, screen coords: y grows
  // downward, so 15..165 traces the lower half = a smile). The stroke is
  // `thick` pixels wide.
  arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, thick: number, c: RGB): void {
    const r = thick / 2;
    for (let deg = a0; deg <= a1; deg += 1) {
      const rad = (deg * Math.PI) / 180;
      this.ellipse(cx + rx * Math.cos(rad), cy + ry * Math.sin(rad), r, r, c, "full");
    }
  }
}

// ---------------------------------------------------------------------------
// PNG encoding: raw RGBA scanlines (filter 0) + zlib deflate + CRC32
// ---------------------------------------------------------------------------

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(canvas: Canvas): Buffer {
  const { w, h, px } = canvas;
  const stride = w * 4 + 1; // one filter byte per row
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0; // filter: None
    px.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type 6 = RGBA
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter: adaptive (we use None per row)
  ihdr[12] = 0; // interlace: none
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Deterministic pseudo-random numbers (LCG) for the skyline windows.
// Fixed seed => identical buildings and windows on every run.
// ---------------------------------------------------------------------------

let rngState = 6 >>> 0;

function nextRand(): number {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 4294967296;
}

function randInt(min: number, max: number): number {
  return min + Math.floor(nextRand() * (max - min + 1));
}

// ---------------------------------------------------------------------------
// Bitmap font: 5x7 glyphs, drawn scaled up for headlines. Every character
// the meme uses is defined here; lowercase falls back to its uppercase
// shape when no lowercase form is listed. "#" = ink, "." = empty.
// ---------------------------------------------------------------------------

const GLYPHS: Record<string, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".####", "#....", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "##..#", "#.#.#", "#..##", "#..##", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  a: [".....", ".....", ".###.", "....#", ".####", "#...#", ".###."],
  b: ["#....", "#....", "####.", "#...#", "#...#", "#...#", "####."],
  d: ["....#", "....#", ".####", "#...#", "#...#", "#...#", ".###."],
  e: [".....", ".....", ".###.", "#...#", "#####", "#....", ".###."],
  f: ["..##.", ".#...", ".#...", "####.", ".#...", ".#...", ".#..."],
  k: ["#....", "#....", "#..#.", "#.#..", "##...", "#.#..", "#..#."],
  m: [".....", ".....", "##.#.", "#.#.#", "#.#.#", "#.#.#", "#.#.#"],
  n: [".....", ".....", "####.", "#...#", "#...#", "#...#", "#...#"],
  o: [".....", ".....", ".###.", "#...#", "#...#", "#...#", ".###."],
  u: [".....", ".....", "#...#", "#...#", "#...#", "#..##", ".##.#"],
  y: [".....", ".....", "#...#", "#...#", "#...#", ".####", "....#"],
  "0": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "...#.", "..#..", "..#..", "..#.."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  ":": [".....", "..#..", ".....", ".....", ".....", "..#..", "....."],
  ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
  $: ["..#..", ".####", "#....", ".###.", "....#", "####.", "..#.."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
};

function glyphFor(ch: string): string[] {
  return GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()] ?? GLYPHS[" "];
}

// Advance width of one character, in pixels, at the given scale.
// Every glyph is 5 cells wide plus 1 cell of tracking; the full stop is
// half-width so an ellipsis ("2013...") stays tight instead of drifting
// apart into spaced dots.
function charAdvance(ch: string, scale: number): number {
  return (ch === "." ? 3 : 6) * scale;
}

function textWidth(text: string, scale: number): number {
  if (text.length === 0) return 0;
  let w = 0;
  for (let i = 0; i < text.length; i++) w += charAdvance(text[i], scale);
  return w - scale;
}

// Draw one glyph with its top-left corner at (x, y), scaled by `scale`.
function drawGlyph(canvas: Canvas, x: number, y: number, ch: string, scale: number, c: RGB): void {
  const g = glyphFor(ch);
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 5; col++) {
      if (g[row][col] === "#") {
        canvas.rect(x + col * scale, y + row * scale, x + (col + 1) * scale, y + (row + 1) * scale, c);
      }
    }
  }
}

// Draw text left-aligned at (x, y) with a dark outline: the glyphs are
// stamped first in the outline colour at every offset inside a small disc
// of radius `outline`, then once in the fill colour on top.
function drawText(
  canvas: Canvas,
  x: number,
  y: number,
  text: string,
  scale: number,
  fill: RGB,
  outline: RGB,
  outlinePx: number,
): void {
  let cx = x;
  for (let i = 0; i < text.length; i++) {
    for (let dy = -outlinePx; dy <= outlinePx; dy++) {
      for (let dx = -outlinePx; dx <= outlinePx; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (dx * dx + dy * dy > (outlinePx + 0.5) * (outlinePx + 0.5)) continue;
        drawGlyph(canvas, cx + dx, y + dy, text[i], scale, outline);
      }
    }
    drawGlyph(canvas, cx, y, text[i], scale, fill);
    cx += charAdvance(text[i], scale);
  }
}

// Draw text horizontally centred on the canvas at top y, with outline.
function drawTextCentred(
  canvas: Canvas,
  y: number,
  text: string,
  scale: number,
  fill: RGB,
  outlinePx: number,
): void {
  const w = textWidth(text, scale);
  const x = Math.round((canvas.w - w) / 2);
  drawText(canvas, x, y, text, scale, fill, INK, outlinePx);
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

function mix(c1: RGB, c2: RGB, k: number): RGB {
  return [
    Math.round(lerp(c1[0], c2[0], k)),
    Math.round(lerp(c1[1], c2[1], k)),
    Math.round(lerp(c1[2], c2[2], k)),
  ];
}

// Sunset gradient: purple at the top, magenta at 55% height, orange at the
// bottom. One horizontal band per row, exactly like the draft.
function drawSky(canvas: Canvas): void {
  for (let y = 0; y < HEIGHT; y++) {
    const t = y / HEIGHT;
    const c = t < 0.55 ? mix(SKY_TOP, SKY_MID, t / 0.55) : mix(SKY_MID, SKY_BOT, (t - 0.55) / 0.45);
    canvas.rect(0, y, WIDTH, y + 1, c);
  }
}

// Big low sun behind the ghost: pale-yellow core inside a deeper halo.
function drawSun(canvas: Canvas): void {
  canvas.circle(512, 450, 150, SUN_OUTER);
  canvas.circle(512, 450, 120, SUN_INNER);
}

// Dark city silhouette along the bottom with a band of lit windows.
// Building widths, heights, gaps and lit windows all come from the seeded
// LCG above, so the skyline is identical on every run.
function drawSkyline(canvas: Canvas): void {
  canvas.rect(0, 800, WIDTH, HEIGHT, CITY);
  let x = 0;
  while (x < WIDTH) {
    const bw = randInt(55, 120);
    const bh = randInt(60, 190);
    canvas.rect(x, 800 - bh, x + bw, 800, CITY);
    for (let wy = 800 - bh + 12; wy < 792; wy += 26) {
      for (let wx = x + 10; wx < x + bw - 8; wx += 22) {
        if (nextRand() < 0.45) {
          canvas.rect(wx, wy, wx + 8, wy + 12, WINDOW_LIT);
        }
      }
    }
    x += bw + randInt(4, 18);
  }
}

// One palm silhouette: a curved trunk with eight drooping fronds.
// `lean` -1 leans left, +1 leans right; `s` scales the whole palm.
function drawPalm(canvas: Canvas, cx: number, base: number, s: number, lean: number): void {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push([cx + lean * t * t * 60, base - t * 300 * s]);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    canvas.thickLine(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], Math.round(14 * s), CITY);
  }
  const [topX, topY] = pts[pts.length - 1];
  for (let ang = -160; ang < 40; ang += 28) {
    const r = (ang * Math.PI) / 180;
    const ex = topX + Math.cos(r) * 150 * s;
    const ey = topY + Math.sin(r) * 55 * s + 45 * s;
    canvas.thickLine(topX, topY, ex, ey, Math.round(10 * s), CITY);
  }
}

// The make.fun ghost: white dome + body, wavy hem, black eyes behind
// black sunglasses, a small smile, and a gold $ coin at its right side.
function drawGhost(canvas: Canvas): void {
  const gx = 512;
  const gy = 560;
  // Dome (top half of a circle) and body block.
  canvas.ellipse(gx, gy - 20, 130, 130, GHOST_WHITE, "top");
  canvas.rect(gx - 130, gy - 20, gx + 130, gy + 90, GHOST_WHITE);
  // Wavy hem: five scallops hanging below the body block.
  for (const cx of [gx - 130, gx - 65, gx, gx + 65, gx + 130]) {
    canvas.ellipse(cx, gy + 90, 33, 33, GHOST_WHITE, "bottom");
  }
  // Eyes (mostly hidden behind the sunglasses, peeking out below them).
  canvas.ellipse(gx - 40, gy - 48, 22, 30, INK, "full");
  canvas.ellipse(gx + 40, gy - 48, 22, 30, INK, "full");
  // Sunglasses: two lenses plus the bridge.
  canvas.rect(gx - 78, gy - 82, gx - 4, gy - 38, SHADES);
  canvas.rect(gx + 4, gy - 82, gx + 78, gy - 38, SHADES);
  canvas.rect(gx - 4, gy - 66, gx + 4, gy - 58, SHADES);
  // Smile: lower arc of a small ellipse.
  canvas.arc(gx, gy + 17, 32, 25, 15, 165, 6, INK);
  // Gold coin with a "$", held at the ghost's right side.
  const coinX = gx + 163;
  const coinY = gy + 63;
  canvas.circle(coinX, coinY, 45, COIN_GOLD);
  canvas.ring(coinX, coinY, 35, 35, 4, COIN_RING);
  const dollarScale = 6;
  const dw = textWidth("$", dollarScale);
  drawText(canvas, coinX - Math.round(dw / 2), coinY - 21, "$", dollarScale, COIN_DARK, COIN_DARK, 0);
}

// Headline at the top and punchline on the skyline band. All text is
// centred, white (or yellow) with a dark outline, and kept clear of the
// ghost and the sun so nothing overlaps the art.
function drawTextLines(canvas: Canvas): void {
  drawTextCentred(canvas, 52, "GTA 6 LAUNCH WEEK", 8, TEXT_WHITE, 5);
  drawTextCentred(canvas, 140, "nobody:", 6, TEXT_YELLOW, 4);
  drawTextCentred(canvas, 196, "WAITING SINCE 2013...", 6, TEXT_WHITE, 4);
  drawTextCentred(canvas, 836, "MEANWHILE MY AGENT IS", 5, TEXT_WHITE, 4);
  drawTextCentred(canvas, 892, "ALREADY EARNING ON", 5, TEXT_WHITE, 4);
  drawTextCentred(canvas, 946, "make.fun", 7, TEXT_YELLOW, 4);
}

function buildMeme(): Buffer {
  rngState = 6 >>> 0; // reset the skyline RNG so every run is identical
  const canvas = new Canvas(WIDTH, HEIGHT);
  drawSky(canvas);
  drawSun(canvas);
  drawSkyline(canvas);
  drawPalm(canvas, 90, 810, 1.0, -1);
  drawPalm(canvas, 950, 810, 0.85, 1);
  drawGhost(canvas);
  drawTextLines(canvas);
  return encodePng(canvas);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main(): void {
  const botDir = process.env.MAKEFUN_BOT_DIR ?? "/bot";
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  fs.mkdirSync(outDir, { recursive: true });

  const png = buildMeme();
  const outPath = path.join(outDir, "meme.png");
  fs.writeFileSync(outPath, png);
  console.log(`wrote ${outPath} (${png.length} bytes, ${WIDTH}x${HEIGHT} PNG)`);

  // POST.json arrives later, after bilsky posts the meme on X. Copy it
  // through when it exists; its absence is not an error.
  const postSrc = path.join(botDir, "POST.json");
  const postDst = path.join(outDir, "POST.json");
  if (fs.existsSync(postSrc)) {
    fs.copyFileSync(postSrc, postDst);
    console.log(`copied ${postSrc} -> ${postDst}`);
  } else {
    console.error(`note: ${postSrc} not present yet (bilsky has not posted); skipping copy`);
  }
}

main();
