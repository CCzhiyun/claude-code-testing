export function moreRightOffset(contentWidth: number, viewportWidth: number, padding = 2): number { return Math.max(0, viewportWidth - contentWidth - padding); }
