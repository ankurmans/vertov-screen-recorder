// Combining videos is part of the hosted service and is not included in this edition. Nothing
// queues a combine job here; the queue consumer keeps this hook so its message types stay the same.

export async function processStitch(_id: string, _sourceIds: Array<string>): Promise<void> {}
