// Loom import is part of the hosted service and is not included in this edition. Nothing queues an
// import job here; the queue consumer keeps this hook so its message types stay the same.

export async function processImport(_id: string, _loomId: string): Promise<void> {}

// Streamed (HLS) videos are copied by the hosted service only.
export async function copyHlsToMp4(_playlistUrl: string, _key: string, _limits: { maxBytes?: number; signal?: AbortSignal } = {}): Promise<number> {
  throw new Error("Streamed videos aren't supported in this edition")
}
