import type { Upload } from "@/db/schema"

// Caption translation is part of the hosted service and is not included in this edition. Captions
// in the recording's own language work as usual.

export async function captionTranslation(_upload: Upload, _language: string): Promise<R2ObjectBody | null> {
  return null
}

export async function translatedLanguages(_upload: Upload): Promise<Array<string>> {
  return []
}

export async function translateCaptions(_upload: Upload, _language: string): Promise<void> {
  throw new Error("Caption translation is not included in this edition")
}
