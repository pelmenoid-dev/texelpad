import type { MapKind, Pixels } from './maps';
export type GrayPalettes = Record<Exclude<MapKind, 'diffuse'>, string[]>;
export const defaultDiffuseColors = ['#222128', '#686572', '#f3eee5', '#805747', '#c56464', '#e9aa72', '#e6cf7d', '#89a66f', '#6ba5a1', '#7794bd', '#a389b5'] as const;
export function createDiffusePalette(): string[] {
  return [...defaultDiffuseColors];
}

// A fixed-size histogram keeps extraction bounded even for a 4096px photo.
// Alpha weights coverage; RGB hidden under fully transparent pixels is ignored.
export function extractDiffusePalette({
  data
}: Pixels): string[] {
  const bins = 1 << 15,
    weight = new Float64Array(bins),
    red = new Float64Array(bins),
    green = new Float64Array(bins),
    blue = new Float64Array(bins);
  const keyOf = (r: number, g: number, b: number) => r >> 3 << 10 | g >> 3 << 5 | b >> 3;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (!alpha) continue;
    const key = keyOf(data[i], data[i + 1], data[i + 2]);
    weight[key] += alpha;
    red[key] += data[i] * alpha;
    green[key] += data[i + 1] * alpha;
    blue[key] += data[i + 2] * alpha;
  }
  const candidates = [];
  for (let key = 0; key < bins; key++) if (weight[key]) candidates.push({
    key,
    r: red[key] / weight[key],
    g: green[key] / weight[key],
    b: blue[key] / weight[key],
    weight: weight[key],
    distance: Infinity
  });
  if (!candidates.length) return [];
  const selected: typeof candidates = [];
  // Balance coverage with separation, so small accents survive beside large fills.
  // Shades within 24 RGB units share a swatch instead of filling the palette.
  while (selected.length < 11) {
    let best: typeof candidates[number] | undefined,
      score = -1;
    for (const c of candidates) {
      if (c.distance < 24 * 24) continue;
      const next = selected.length ? Math.sqrt(c.weight) * c.distance : c.weight;
      if (next > score) {
        score = next;
        best = c;
      }
    }
    if (!best) break;
    selected.push(best);
    for (const c of candidates) c.distance = Math.min(c.distance, (c.r - best.r) ** 2 + (c.g - best.g) ** 2 + (c.b - best.b) ** 2);
  }

  // Use actual source colors nearest the chosen bins' means, not invented averages.
  const selectedIndex = new Int16Array(bins).fill(-1),
    nearest = new Float64Array(selected.length).fill(Infinity),
    colors = new Uint32Array(selected.length);
  selected.forEach((c, i) => {
    selectedIndex[c.key] = i;
  });
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2],
      index = selectedIndex[keyOf(r, g, b)];
    if (index < 0) continue;
    const c = selected[index],
      distance = (r - c.r) ** 2 + (g - c.g) ** 2 + (b - c.b) ** 2,
      color = r << 16 | g << 8 | b;
    if (distance < nearest[index] || distance === nearest[index] && color < colors[index]) {
      nearest[index] = distance;
      colors[index] = color;
    }
  }
  const brightness = (color: number) => (color >> 16 & 255) * .2126 + (color >> 8 & 255) * .7152 + (color & 255) * .0722;
  return Array.from(colors).sort((a, b) => brightness(a) - brightness(b) || a - b).map(c => '#' + c.toString(16).padStart(6, '0'));
}
export const defaultGrayColors = ['#000000', '#404040', '#808080', '#bfbfbf', '#ffffff'];
export function createGrayPalettes(): GrayPalettes {
  return {
    spec: [...defaultGrayColors],
    glow: [...defaultGrayColors]
  };
}
export function grayHex(value: number) {
  const channel = Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, '0');
  return '#' + channel.repeat(3);
}
export function isPaletteColor(color: unknown, grayscale = false): color is string {
  if (typeof color !== 'string' || !/^#[a-f0-9]{6}$/i.test(color)) return false;
  const normalized = color.toLowerCase();
  return !grayscale || normalized.slice(1, 3) === normalized.slice(3, 5) && normalized.slice(1, 3) === normalized.slice(5, 7);
}
