export const ASCII_PRESETS: Record<string, string> = {
  standard: "@#S%?*+;:,. ",
  detailed: "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'. ",
  blocks: "█▓▒░ ",
  simple: "#@+-. ",
  binary: "10 ",
  braille: "⣿⣷⣯⣟⡿⢿⣻⣽⣾⣼⣸⣰⣤⣄⣀⠿⠾⠼⠸⠰⠠⠀",
  minimal: "@% ",
  wingdings: " .+*vlnopqm",
  webdings: " .+*vlnopqm",
  symbols: " ·∘◌○◎◉●",
  "geometric shapes": "⬛◼■◆●◉◎○◌ ",
  arrows: "⬛▲⬆⇧⇑↑←→↔⇦⇨⇒ ",
  "box drawing": "╬╋┿┼╪╫┤├┬┴┐└─│ ",
  stars: "✸❋★✺✶✷✵✦☆✧· ",
};

export type RenderMode = "ascii" | "halftone" | "bitmap" | "posterize" | "tiles";
export type HalftoneShape = "circle" | "square" | "hexagon";
export type BitmapStyle = "color" | "mono" | "dithered";
export type TileShape =
  | "solid" | "ring" | "cross" | "x" | "slash" | "backslash" | "diamond"
  | "square-outline" | "circle-filled" | "diamond-filled"
  | "tri-tl" | "tri-tr" | "tri-br" | "tri-bl"
  | "tri-apex-t" | "tri-apex-b" | "tri-apex-l" | "tri-apex-r"
  | "tri-htl-h" | "tri-htl-v" | "tri-htr-h" | "tri-htr-v"
  | "tri-hbr-h" | "tri-hbr-v" | "tri-hbl-h" | "tri-hbl-v";
export type TileColorMode = "source" | "theme";

// Fixed density order: densest (most ink) → sparsest (least ink).
// Used to sort selected shapes so brightness maps dark→dense, bright→sparse.
export const TILE_DENSITY_ORDER: TileShape[] = [
  "solid", "circle-filled",
  "tri-tl", "tri-tr", "tri-br", "tri-bl", "diamond-filled",
  "tri-apex-t", "tri-apex-b", "tri-apex-l", "tri-apex-r",
  "x",
  "tri-htl-h", "tri-htl-v", "tri-htr-h", "tri-htr-v",
  "tri-hbr-h", "tri-hbr-v", "tri-hbl-h", "tri-hbl-v",
  "cross", "square-outline", "backslash", "slash", "ring", "diamond",
];

export interface AsciiOptions {
  chars: string;
  bgColor: string;
  textColor: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  startTime: number;
  endTime: number;
  brightness: number;
  contrast: number;
  exposure: number;
  gamma: number;
  invert: boolean;
  useMidColor: boolean;
  midColors: string[];
  midColorStrict: boolean;
  renderMode: RenderMode;
  halftoneShape: HalftoneShape;
  bitmapStyle: BitmapStyle;
  useMosaicZones: boolean;
  mosaicZoneSize: number;
  posterizeBands: number;
  posterizeColors: string[];
  posterizeCellSize: number;
  posterizeSmooth: number;
  posterizeBlend: number;
  tileShapes: TileShape[];
  tileLineWidth: number;
  tileColorMode: TileColorMode;
  tileScaleWithBrightness: boolean;
}

// Cubic smoothstep — maps t∈[0,1] to a smooth S-curve
function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

// 4×4 Bayer ordered dithering matrix (values 0–15, normalise by /16)
const BAYER_4X4 = [
  [ 0,  8,  2, 10],
  [12,  4, 14,  6],
  [ 3, 11,  1,  9],
  [15,  7, 13,  5],
];

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function lerpColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bv = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bv})`;
}

// Build the full stop list: [bg, ...mids, text] as rgb tuples
function buildStops(
  rgbBg: [number, number, number],
  midColors: string[],
  rgbText: [number, number, number]
): [number, number, number][] {
  return [rgbBg, ...midColors.map(hexToRgb), rgbText];
}

function getCharColor(
  lum: number,
  useMidColor: boolean,
  stops: [number, number, number][],  // [bg, ...mids, text]
  textColor: string,
  strict = false
): string {
  // Without midtones and not strict: always text colour (original behaviour)
  if (!useMidColor && !strict) return textColor;

  const n = stops.length;
  if (n < 2) return textColor;

  if (strict) {
    if (!useMidColor) {
      // No midtones: binary snap — bg below 50% luminance, text at or above
      // Ignore any mid stops that may be stored in state; only use endpoints
      const bg = stops[0], text = stops[n - 1];
      return lum < 0.5
        ? `rgb(${bg[0]},${bg[1]},${bg[2]})`
        : `rgb(${text[0]},${text[1]},${text[2]})`;
    }
    // Midtones enabled: snap to the nearest stop across bg→mids→text
    const idx = Math.min(n - 1, Math.round(lum * (n - 1)));
    const c = stops[idx];
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  // Gradient: find which segment lum falls in and lerp within it
  const segCount = n - 1;
  const scaled = lum * segCount;
  const seg = Math.min(segCount - 1, Math.floor(scaled));
  return lerpColor(stops[seg], stops[seg + 1], scaled - seg);
}

function sampleSource(
  source: HTMLVideoElement | HTMLImageElement,
  canvas: HTMLCanvasElement,
  cols: number,
  rows: number,
  brightness: number,
  contrast: number,
  invert: boolean = false,
  blur: number = 0,
  exposure: number = 0,
  gamma: number = 1
): Uint8ClampedArray {
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const blurFilter = blur > 0 ? `blur(${blur}px) ` : "";
  const invertFilter = invert ? " invert(100%)" : "";
  ctx.filter = `${blurFilter}brightness(${brightness}%) contrast(${contrast}%)${invertFilter}`;
  ctx.drawImage(source, 0, 0, cols, rows);
  ctx.filter = "none";

  // Fast path: skip per-pixel work when both values are at neutral
  if (exposure === 0 && gamma === 1) {
    return ctx.getImageData(0, 0, cols, rows).data;
  }

  const imageData = ctx.getImageData(0, 0, cols, rows);
  const data = imageData.data;
  const expMult = Math.pow(2, exposure);
  const gammaInv = 1 / Math.max(0.01, gamma);

  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let v = data[i + c] / 255;
      // Exposure: multiply by 2^stops (camera analogy)
      if (exposure !== 0) v = Math.min(1, v * expMult);
      // Gamma: power-curve — gamma>1 darkens midtones, gamma<1 brightens
      if (gamma !== 1) v = Math.pow(v, gammaInv);
      data[i + c] = Math.round(v * 255);
    }
  }
  return data;
}

export function frameToAscii(
  source: HTMLVideoElement | HTMLImageElement,
  canvas: HTMLCanvasElement,
  outputCanvas: HTMLCanvasElement,
  options: AsciiOptions
): void {
  const { chars, bgColor, textColor, fontSize, fontFamily, fontWeight, brightness, contrast, exposure, gamma, invert, useMidColor, midColors, midColorStrict } = options;
  const charSet = chars.split("");
  if (charSet.length === 0) return;

  const outCtx = outputCanvas.getContext("2d");
  if (!outCtx) return;

  const fontStr = `${fontWeight} ${fontSize}px '${fontFamily}', 'Courier New', monospace`;
  outCtx.font = fontStr;
  const charWidth = outCtx.measureText("M").width;
  const charHeight = fontSize;
  const cols = Math.max(1, Math.floor(outputCanvas.width / charWidth));
  const rows = Math.max(1, Math.floor(outputCanvas.height / charHeight));

  const data = sampleSource(source, canvas, cols, rows, brightness, contrast, invert, 0, exposure, gamma);

  outCtx.fillStyle = bgColor;
  outCtx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
  outCtx.font = fontStr;
  outCtx.textBaseline = "top";

  const rgbBg = hexToRgb(bgColor);
  const rgbText = hexToRgb(textColor);
  const stops = buildStops(rgbBg, midColors, rgbText);

  // If neither midtones nor strict, colour never varies — set once outside loop
  const perCellColor = useMidColor || midColorStrict;
  if (!perCellColor) outCtx.fillStyle = textColor;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = (row * cols + col) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const charIdx = Math.floor(lum * (charSet.length - 1));
      if (perCellColor) {
        outCtx.fillStyle = getCharColor(lum, useMidColor, stops, textColor, midColorStrict);
      }
      outCtx.fillText(charSet[charIdx], col * charWidth, row * charHeight);
    }
  }
}

function drawHexagon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

export function frameToHalftone(
  source: HTMLVideoElement | HTMLImageElement,
  canvas: HTMLCanvasElement,
  outputCanvas: HTMLCanvasElement,
  options: AsciiOptions
): void {
  const {
    bgColor, textColor, fontSize: cellSize, brightness, contrast, exposure, gamma, invert,
    useMidColor, midColors, midColorStrict, halftoneShape, useMosaicZones, mosaicZoneSize,
  } = options;

  const outCtx = outputCanvas.getContext("2d");
  if (!outCtx) return;

  const isHex = halftoneShape === "hexagon";
  const colSpacing = cellSize;
  const rowSpacing = isHex ? cellSize * (Math.sqrt(3) / 2) : cellSize;

  const cols = Math.ceil(outputCanvas.width / colSpacing) + 2;
  const rows = Math.ceil(outputCanvas.height / rowSpacing) + 2;

  // Fine-grained per-cell sample (used when mosaic is off)
  const data = sampleSource(source, canvas, cols, rows, brightness, contrast, invert, 0, exposure, gamma);

  // Zone-level sample for mosaic mode — separate scratch canvas so we don't clobber the fine one
  let zoneData: Uint8ClampedArray | null = null;
  let zoneCols = 0, zoneRows = 0;
  if (useMosaicZones && mosaicZoneSize >= 8) {
    zoneCols = Math.max(1, Math.ceil(outputCanvas.width / mosaicZoneSize));
    zoneRows = Math.max(1, Math.ceil(outputCanvas.height / mosaicZoneSize));
    const zoneCanvas = document.createElement("canvas");
    zoneData = sampleSource(source, zoneCanvas, zoneCols, zoneRows, brightness, contrast, invert, 0, exposure, gamma);
  }

  outCtx.fillStyle = bgColor;
  outCtx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);

  const rgbBg = hexToRgb(bgColor);
  const rgbText = hexToRgb(textColor);
  const stops = buildStops(rgbBg, midColors, rgbText);
  const maxRadius = (cellSize / 2) * 1.05;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const hexOffset = isHex && row % 2 === 1 ? colSpacing * 0.5 : 0;
      const cx = col * colSpacing + colSpacing * 0.5 + hexOffset;
      const cy = row * rowSpacing + rowSpacing * 0.5;

      let lum: number;
      if (zoneData) {
        // Snap this dot's centre position to its zone bucket
        const zc = Math.min(Math.floor(cx / mosaicZoneSize), zoneCols - 1);
        const zr = Math.min(Math.floor(cy / mosaicZoneSize), zoneRows - 1);
        const zi = (zr * zoneCols + zc) * 4;
        lum = (0.299 * zoneData[zi] + 0.587 * zoneData[zi + 1] + 0.114 * zoneData[zi + 2]) / 255;
      } else {
        const idx = (row * cols + col) * 4;
        lum = (0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]) / 255;
      }

      if (lum < 0.015) continue;

      const radius = lum * maxRadius;
      outCtx.fillStyle = getCharColor(lum, useMidColor, stops, textColor, midColorStrict);

      if (halftoneShape === "circle") {
        outCtx.beginPath();
        outCtx.arc(cx, cy, radius, 0, Math.PI * 2);
        outCtx.fill();
      } else if (halftoneShape === "square") {
        outCtx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
      } else {
        drawHexagon(outCtx, cx, cy, radius);
      }
    }
  }
}

export function frameToPosterize(
  source: HTMLVideoElement | HTMLImageElement,
  canvas: HTMLCanvasElement,
  outputCanvas: HTMLCanvasElement,
  options: AsciiOptions
): void {
  const { brightness, contrast, exposure, gamma, invert, posterizeBands, posterizeColors, posterizeCellSize, posterizeSmooth, posterizeBlend } = options;
  const cellSize = Math.max(1, posterizeCellSize);

  const outCtx = outputCanvas.getContext("2d");
  if (!outCtx) return;

  const bands = Math.max(2, Math.min(6, posterizeBands));
  const cols = Math.ceil(outputCanvas.width / cellSize);
  const rows = Math.ceil(outputCanvas.height / cellSize);
  const n = cols * rows;

  // Sample with no blur — mode filter handles noise removal after quantisation
  const data = sampleSource(source, canvas, cols, rows, brightness, contrast, invert, 0, exposure, gamma);

  // Pre-convert all band colours to RGB tuples once
  const rgbColors = posterizeColors.map(hexToRgb) as [number, number, number][];

  // Pass 1 — compute luminance and hard-snap band index for every pixel
  const lums = new Float32Array(n);
  const bandMap = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const bi = i * 4;
    const lum = (0.299 * data[bi] + 0.587 * data[bi + 1] + 0.114 * data[bi + 2]) / 255;
    lums[i] = lum;
    bandMap[i] = Math.min(bands - 1, Math.floor(lum * bands));
  }

  // Pass 2 — mode filter: each pixel adopts the most common band in its neighbourhood.
  // Large regions always outvote small isolated patches → edges stay perfectly sharp.
  let finalMap = bandMap;
  if (posterizeSmooth > 0) {
    const R = Math.max(0, Math.min(8, Math.round(posterizeSmooth)));
    const filtered = new Uint8Array(n);
    const counts = new Array<number>(bands);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        counts.fill(0);
        for (let dy = -R; dy <= R; dy++) {
          const nr = Math.min(rows - 1, Math.max(0, row + dy));
          const nrOff = nr * cols;
          for (let dx = -R; dx <= R; dx++) {
            const nc = Math.min(cols - 1, Math.max(0, col + dx));
            counts[bandMap[nrOff + nc]]++;
          }
        }
        let best = 0;
        for (let b = 1; b < bands; b++) {
          if (counts[b] > counts[best]) best = b;
        }
        filtered[row * cols + col] = best;
      }
    }
    finalMap = filtered;
  }

  // Initial fill with the darkest band colour
  const bg = rgbColors[0] ?? [0, 0, 0];
  outCtx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
  outCtx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);

  // Render pass — BLEND edge-smoothing uses original luminance for the transition
  // trigger but the mode-filtered band as the base, so boundary softness is
  // preserved while mode-filter reassignments also take effect.
  const BLEND = Math.max(0, Math.min(0.5, posterizeBlend));

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      const bandIdx = finalMap[i];
      const bandFloat = lums[i] * bands;
      const t = bandFloat - Math.floor(bandFloat);

      let fillStyle: string;
      if (t > 1 - BLEND && bandIdx < bands - 1) {
        const s = smoothstep((t - (1 - BLEND)) / BLEND);
        fillStyle = lerpColor(rgbColors[bandIdx], rgbColors[bandIdx + 1], s);
      } else {
        const c = rgbColors[bandIdx] ?? rgbColors[rgbColors.length - 1];
        fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      }

      outCtx.fillStyle = fillStyle;
      outCtx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
    }
  }
}

export function frameToBitmap(
  source: HTMLVideoElement | HTMLImageElement,
  canvas: HTMLCanvasElement,
  outputCanvas: HTMLCanvasElement,
  options: AsciiOptions
): void {
  const { bgColor, textColor, fontSize: cellSize, brightness, contrast, exposure, gamma, invert, bitmapStyle, useMosaicZones, mosaicZoneSize, useMidColor, midColors, midColorStrict } = options;

  const outCtx = outputCanvas.getContext("2d");
  if (!outCtx) return;

  const cols = Math.ceil(outputCanvas.width / cellSize);
  const rows = Math.ceil(outputCanvas.height / cellSize);

  const data = sampleSource(source, canvas, cols, rows, brightness, contrast, invert, 0, exposure, gamma);

  // mosaic zone pre-pass: compute per-zone average colour so all cells in a zone share the same value
  let zoneData: Uint8ClampedArray | null = null;
  if (useMosaicZones && mosaicZoneSize >= 8) {
    const zCtx = canvas.getContext("2d");
    if (zCtx) {
      const zoneCols = Math.ceil(outputCanvas.width / mosaicZoneSize);
      const zoneRows = Math.ceil(outputCanvas.height / mosaicZoneSize);
      const zoneRaw = sampleSource(source, canvas, zoneCols, zoneRows, brightness, contrast, invert, 0, exposure, gamma);
      zoneData = new Uint8ClampedArray(cols * rows * 4);
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const cellX = col * cellSize;
          const cellY = row * cellSize;
          const zCol = Math.min(Math.floor(cellX / mosaicZoneSize), zoneCols - 1);
          const zRow = Math.min(Math.floor(cellY / mosaicZoneSize), zoneRows - 1);
          const zIdx = (zRow * zoneCols + zCol) * 4;
          const dIdx = (row * cols + col) * 4;
          zoneData[dIdx]     = zoneRaw[zIdx];
          zoneData[dIdx + 1] = zoneRaw[zIdx + 1];
          zoneData[dIdx + 2] = zoneRaw[zIdx + 2];
          zoneData[dIdx + 3] = 255;
        }
      }
    }
  }

  const finalData = zoneData ?? data;

  const rgbBg = hexToRgb(bgColor);
  const rgbText = hexToRgb(textColor);
  const stops = buildStops(rgbBg, midColors, rgbText);

  outCtx.fillStyle = bgColor;
  outCtx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = (row * cols + col) * 4;
      const r = finalData[idx], g = finalData[idx + 1], b = finalData[idx + 2];
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

      const x = col * cellSize;
      const y = row * cellSize;

      if (bitmapStyle === "color") {
        outCtx.fillStyle = `rgb(${r},${g},${b})`;
        outCtx.fillRect(x, y, cellSize, cellSize);
      } else if (bitmapStyle === "mono") {
        if (lum >= 0.5) {
          // with midtones: pick colour from the gradient/stops; without: always text colour
          outCtx.fillStyle = useMidColor
            ? getCharColor(lum, true, stops, textColor, midColorStrict)
            : textColor;
          outCtx.fillRect(x, y, cellSize, cellSize);
        }
      } else {
        // dithered — Bayer 4×4 ordered dither
        const threshold = BAYER_4X4[row % 4][col % 4] / 16;
        if (lum > threshold) {
          if (useMidColor) {
            // midtones: gradient or strict snap across all stops
            outCtx.fillStyle = getCharColor(lum, true, stops, textColor, midColorStrict);
          } else if (midColorStrict) {
            // strict, no midtones: purely binary — cell is exactly textColor
            outCtx.fillStyle = textColor;
          } else {
            // default (no midtones, no strict): soft blend bg→text by how far above threshold
            const t = Math.min(1, (lum - threshold) / (1 - threshold + 0.001));
            outCtx.fillStyle = lerpColor(rgbBg, rgbText, t);
          }
          outCtx.fillRect(x, y, cellSize, cellSize);
        }
      }
    }
  }
}

function drawTileShape(
  outCtx: CanvasRenderingContext2D,
  shape: TileShape,
  x: number, y: number, s: number, lw: number
): void {
  const cx = x + s / 2;
  const cy = y + s / 2;

  if (shape === "solid") {
    outCtx.fillRect(x, y, s, s);
  } else if (shape === "ring") {
    const radius = s / 2 - lw / 2;
    if (radius > 0) {
      outCtx.beginPath();
      outCtx.arc(cx, cy, radius, 0, Math.PI * 2);
      outCtx.stroke();
    }
  } else if (shape === "cross") {
    outCtx.beginPath();
    outCtx.moveTo(cx, y);
    outCtx.lineTo(cx, y + s);
    outCtx.moveTo(x, cy);
    outCtx.lineTo(x + s, cy);
    outCtx.stroke();
  } else if (shape === "x") {
    outCtx.beginPath();
    outCtx.moveTo(x, y);
    outCtx.lineTo(x + s, y + s);
    outCtx.moveTo(x + s, y);
    outCtx.lineTo(x, y + s);
    outCtx.stroke();
  } else if (shape === "slash") {
    outCtx.beginPath();
    outCtx.moveTo(x, y + s);
    outCtx.lineTo(x + s, y);
    outCtx.stroke();
  } else if (shape === "backslash") {
    outCtx.beginPath();
    outCtx.moveTo(x, y);
    outCtx.lineTo(x + s, y + s);
    outCtx.stroke();
  } else if (shape === "diamond") {
    outCtx.beginPath();
    outCtx.moveTo(cx, y);
    outCtx.lineTo(x + s, cy);
    outCtx.lineTo(cx, y + s);
    outCtx.lineTo(x, cy);
    outCtx.closePath();
    outCtx.stroke();

  // ── New filled primitives ──────────────────────────────────────
  } else if (shape === "square-outline") {
    const half = lw / 2;
    outCtx.strokeRect(x + half, y + half, s - lw, s - lw);
  } else if (shape === "circle-filled") {
    outCtx.beginPath();
    outCtx.arc(cx, cy, s / 2, 0, Math.PI * 2);
    outCtx.fill();
  } else if (shape === "diamond-filled") {
    outCtx.beginPath();
    outCtx.moveTo(cx, y);
    outCtx.lineTo(x + s, cy);
    outCtx.lineTo(cx, y + s);
    outCtx.lineTo(x, cy);
    outCtx.closePath();
    outCtx.fill();

  // ── Corner triangles (right angle at each corner, fills diagonal half) ──
  } else if (shape === "tri-tl") {
    // Right angle at top-left
    outCtx.beginPath();
    outCtx.moveTo(x, y);
    outCtx.lineTo(x + s, y);
    outCtx.lineTo(x, y + s);
    outCtx.closePath();
    outCtx.fill();
  } else if (shape === "tri-tr") {
    // Right angle at top-right
    outCtx.beginPath();
    outCtx.moveTo(x + s, y);
    outCtx.lineTo(x, y);
    outCtx.lineTo(x + s, y + s);
    outCtx.closePath();
    outCtx.fill();
  } else if (shape === "tri-br") {
    // Right angle at bottom-right
    outCtx.beginPath();
    outCtx.moveTo(x + s, y + s);
    outCtx.lineTo(x + s, y);
    outCtx.lineTo(x, y + s);
    outCtx.closePath();
    outCtx.fill();
  } else if (shape === "tri-bl") {
    // Right angle at bottom-left
    outCtx.beginPath();
    outCtx.moveTo(x, y + s);
    outCtx.lineTo(x, y);
    outCtx.lineTo(x + s, y + s);
    outCtx.closePath();
    outCtx.fill();

  // ── Center-apex triangles (apex at midpoint of side, full-width base) ──
  } else if (shape === "tri-apex-t") {
    // Apex at top-center, base at bottom
    outCtx.beginPath();
    outCtx.moveTo(cx, y);
    outCtx.lineTo(x, y + s);
    outCtx.lineTo(x + s, y + s);
    outCtx.closePath();
    outCtx.fill();
  } else if (shape === "tri-apex-b") {
    // Apex at bottom-center, base at top
    outCtx.beginPath();
    outCtx.moveTo(cx, y + s);
    outCtx.lineTo(x, y);
    outCtx.lineTo(x + s, y);
    outCtx.closePath();
    outCtx.fill();
  } else if (shape === "tri-apex-l") {
    // Apex at left-center, base at right
    outCtx.beginPath();
    outCtx.moveTo(x, cy);
    outCtx.lineTo(x + s, y);
    outCtx.lineTo(x + s, y + s);
    outCtx.closePath();
    outCtx.fill();
  } else if (shape === "tri-apex-r") {
    // Apex at right-center, base at left
    outCtx.beginPath();
    outCtx.moveTo(x + s, cy);
    outCtx.lineTo(x, y);
    outCtx.lineTo(x, y + s);
    outCtx.closePath();
    outCtx.fill();

  // ── Half-leg triangles (right angle at corner, one full leg + one half leg) ──
  // Naming: tri-h<corner>-<h|v>  where h = short leg is horizontal, v = short leg is vertical
  } else if (shape === "tri-htl-h") {
    // TL corner, short top leg (half), full left leg
    outCtx.beginPath();
    outCtx.moveTo(x, y);
    outCtx.lineTo(x + s / 2, y);
    outCtx.lineTo(x, y + s);
    outCtx.closePath();
    outCtx.fill();
  } else if (shape === "tri-htl-v") {
    // TL corner, full top leg, short left leg (half)
    outCtx.beginPath();
    outCtx.moveTo(x, y);
    outCtx.lineTo(x + s, y);
    outCtx.lineTo(x, y + s / 2);
    outCtx.closePath();
    outCtx.fill();
  } else if (shape === "tri-htr-h") {
    // TR corner, short top leg from right (half), full right leg
    outCtx.beginPath();
    outCtx.moveTo(x + s, y);
    outCtx.lineTo(x + s / 2, y);
    outCtx.lineTo(x + s, y + s);
    outCtx.closePath();
    outCtx.fill();
  } else if (shape === "tri-htr-v") {
    // TR corner, full top leg, short right leg (half)
    outCtx.beginPath();
    outCtx.moveTo(x + s, y);
    outCtx.lineTo(x, y);
    outCtx.lineTo(x + s, y + s / 2);
    outCtx.closePath();
    outCtx.fill();
  } else if (shape === "tri-hbr-h") {
    // BR corner, short bottom leg from right (half), full right leg going up
    outCtx.beginPath();
    outCtx.moveTo(x + s, y + s);
    outCtx.lineTo(x + s / 2, y + s);
    outCtx.lineTo(x + s, y);
    outCtx.closePath();
    outCtx.fill();
  } else if (shape === "tri-hbr-v") {
    // BR corner, full bottom leg, short right leg (half from bottom)
    outCtx.beginPath();
    outCtx.moveTo(x + s, y + s);
    outCtx.lineTo(x, y + s);
    outCtx.lineTo(x + s, y + s / 2);
    outCtx.closePath();
    outCtx.fill();
  } else if (shape === "tri-hbl-h") {
    // BL corner, short bottom leg from left (half), full left leg going up
    outCtx.beginPath();
    outCtx.moveTo(x, y + s);
    outCtx.lineTo(x + s / 2, y + s);
    outCtx.lineTo(x, y);
    outCtx.closePath();
    outCtx.fill();
  } else if (shape === "tri-hbl-v") {
    // BL corner, full bottom leg, short left leg (half from bottom)
    outCtx.beginPath();
    outCtx.moveTo(x, y + s);
    outCtx.lineTo(x + s, y + s);
    outCtx.lineTo(x, y + s / 2);
    outCtx.closePath();
    outCtx.fill();
  }
}

export function frameToTiles(
  source: HTMLVideoElement | HTMLImageElement,
  canvas: HTMLCanvasElement,
  outputCanvas: HTMLCanvasElement,
  options: AsciiOptions
): void {
  const {
    bgColor, textColor, fontSize: cellSize, brightness, contrast, exposure, gamma, invert,
    tileShapes, tileLineWidth, tileColorMode, tileScaleWithBrightness,
    useMidColor, midColors, midColorStrict,
  } = options;

  const outCtx = outputCanvas.getContext("2d");
  if (!outCtx) return;

  // Sort selected shapes from densest to sparsest using the fixed density order.
  // Dark (low lum) cells → index 0 (densest); bright (high lum) → last (sparsest).
  const sorted = TILE_DENSITY_ORDER.filter((s) => tileShapes.includes(s));
  if (sorted.length === 0) return;
  const n = sorted.length;

  const cols = Math.ceil(outputCanvas.width / cellSize);
  const rows = Math.ceil(outputCanvas.height / cellSize);
  const data = sampleSource(source, canvas, cols, rows, brightness, contrast, invert, 0, exposure, gamma);

  outCtx.fillStyle = bgColor;
  outCtx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);

  outCtx.lineCap = "square";

  // Pre-build theme colour stops once (only used in "theme" mode)
  const rgbBg = hexToRgb(bgColor);
  const rgbText = hexToRgb(textColor);
  const stops = buildStops(rgbBg, midColors, rgbText);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = (row * cols + col) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];

      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

      // Pick shape: dark → densest (index 0), bright → sparsest (index n-1)
      const shapeIdx = Math.min(n - 1, Math.floor(lum * n));
      const shape = sorted[shapeIdx];

      // Pick colour
      let color: string;
      if (tileColorMode === "theme") {
        color = getCharColor(lum, useMidColor, stops, textColor, midColorStrict);
      } else {
        color = `rgba(${r},${g},${b},${a / 255})`;
      }

      const cellX = col * cellSize;
      const cellY = row * cellSize;

      // When scaling with brightness, shrink shape proportionally to luminance,
      // keeping it centred in its cell (dark = full-size, bright = tiny/invisible).
      // lum=0 → full cell, lum=1 → invisible.
      let x = cellX;
      let y = cellY;
      let s = cellSize;
      if (tileScaleWithBrightness) {
        s = cellSize * (1 - lum);
        if (s < 0.5) continue;
        x = cellX + (cellSize - s) / 2;
        y = cellY + (cellSize - s) / 2;
      }

      const scaledLw = Math.max(1, Math.round(s * tileLineWidth));
      outCtx.lineWidth = scaledLw;

      outCtx.fillStyle = color;
      outCtx.strokeStyle = color;
      drawTileShape(outCtx, shape, x, y, s, scaledLw);
    }
  }
}
