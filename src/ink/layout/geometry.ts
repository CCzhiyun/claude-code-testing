export interface Point { x: number; y: number }
export interface Size { width: number; height: number }
export interface Rectangle extends Point, Size {}
export const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));
export function contains(rectangle: Rectangle, point: Point): boolean { return point.x >= rectangle.x && point.y >= rectangle.y && point.x < rectangle.x + rectangle.width && point.y < rectangle.y + rectangle.height; }
export function intersect(left: Rectangle, right: Rectangle): Rectangle | undefined { const x = Math.max(left.x, right.x); const y = Math.max(left.y, right.y); const edgeX = Math.min(left.x + left.width, right.x + right.width); const edgeY = Math.min(left.y + left.height, right.y + right.height); return edgeX > x && edgeY > y ? { x, y, width: edgeX - x, height: edgeY - y } : undefined; }
export function unionRect(left: Rectangle, right: Rectangle): Rectangle { const x = Math.min(left.x, right.x); const y = Math.min(left.y, right.y); return { x, y, width: Math.max(left.x + left.width, right.x + right.width) - x, height: Math.max(left.y + left.height, right.y + right.height) - y }; }
export function translate(rectangle: Rectangle, x: number, y: number): Rectangle { return { ...rectangle, x: rectangle.x + x, y: rectangle.y + y }; }
export function inset(rectangle: Rectangle, top: number, right = top, bottom = top, left = right): Rectangle { return { x: rectangle.x + left, y: rectangle.y + top, width: Math.max(0, rectangle.width - left - right), height: Math.max(0, rectangle.height - top - bottom) }; }
