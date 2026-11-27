import { common } from "./common.ts"
import { library } from "./library.ts"
import { recorder } from "./recorder.ts"
import { settings } from "./settings.ts"
import { video } from "./video.ts"
import { auth } from "./auth.ts"
import { hosted } from "./hosted.ts"

export const en = { ...common, ...library, ...recorder, ...settings, ...video, ...auth, ...hosted } as const
export type MessageKey = keyof typeof en
