// Loom import is part of the hosted service and is not included in this edition. Nothing queues an
// import job here; the queue consumer keeps this hook so its message types stay the same.

export async function processImport(_id: string, _loomId: string): Promise<void> {}
