import { common } from "./common.ts"
import { library } from "./library.ts"
import { recorder } from "./recorder.ts"
import { settings } from "./settings.ts"
import { video } from "./video.ts"
import { auth } from "./auth.ts"
import { hosted } from "./hosted.ts"
import type { MessageKey } from "../en/index.ts"
import type { Message } from "../core.ts"

export const de: Record<MessageKey, Message> = { ...common, ...library, ...recorder, ...settings, ...video, ...auth, ...hosted }
