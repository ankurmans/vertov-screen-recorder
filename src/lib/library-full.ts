// This edition has no library limit, so nothing ever reports a full library.
export interface LibraryFull {
  message: string
}

export class LibraryFullError extends Error {
  library: LibraryFull
  constructor(message: string, library: LibraryFull) {
    super(message)
    this.name = "LibraryFullError"
    this.library = library
  }
}

export const libraryFromBody = (_body: unknown): LibraryFull | null => null
