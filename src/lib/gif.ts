// Animated GIF thumbnails are part of the hosted service and are not included in this edition.

export function makeAnimatedThumbnail(_src: string, _from: number, _to: number, _width = 480, _count = 14): Promise<Blob> {
  return Promise.reject(new Error("Animated thumbnails are not included in this edition"))
}
