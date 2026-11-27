import type { Message } from "./core.ts"

/** The shape every translation of an English area must have: the same keys, each a string or plural forms. */
export type Translations<English> = { [Key in keyof English]: Message }
