export interface MeasurableElement { frame?: { width: number; height: number }; layout?: { width: number; height: number } }
export default function measureElement(element: MeasurableElement): { width: number; height: number } { const value = element.frame ?? element.layout; return { width: Math.max(0, value?.width ?? 0), height: Math.max(0, value?.height ?? 0) }; }
