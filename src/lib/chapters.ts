export interface Chapter {
  title: string
  startTime: number
  endTime: number
}

/** Finds the chapter at a given time position. */
export function getChapterAtTime(
  chapters: Array<Chapter>,
  time: number,
): Chapter | null {
  for (let i = chapters.length - 1; i >= 0; i--) {
    if (time >= chapters[i].startTime) {
      return chapters[i]
    }
  }
  return chapters[0] ?? null
}
