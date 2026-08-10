export const ZOOM_MIN = 0.4
export const ZOOM_MAX = 2.5

export interface Point {
  clientX: number
  clientY: number
}

export const touchGap = (first: Point, second: Point): number =>
  Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)

export interface Pinch {
  gap: number
  zoom: number
}

export const pinchedZoom = (start: Pinch, gap: number): number => {
  if (start.gap <= 0) return start.zoom

  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, start.zoom * (gap / start.gap)))
}
