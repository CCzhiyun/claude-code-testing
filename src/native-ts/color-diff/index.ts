export interface RgbColor { r: number; g: number; b: number }
export function colorDistance(left: RgbColor, right: RgbColor): number {
  for (const color of [left, right]) for (const value of [color.r, color.g, color.b]) if (!Number.isFinite(value) || value < 0 || value > 255) throw new Error('RGB channel must be between 0 and 255');
  const redMean = (left.r + right.r) / 2;
  const red = left.r - right.r, green = left.g - right.g, blue = left.b - right.b;
  return Math.sqrt((2 + redMean / 256) * red ** 2 + 4 * green ** 2 + (2 + (255 - redMean) / 256) * blue ** 2);
}
export function nearestColor(target: RgbColor, palette: RgbColor[]): RgbColor | undefined { return [...palette].sort((a, b) => colorDistance(target, a) - colorDistance(target, b))[0]; }
