export interface Brand {
  color: string | null
  logo: string | null
  name: string
}

export const HEX_COLOR = /^#[0-9a-f]{6}$/i

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

const contrastWithWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05)

/** The accent, darkened until it is readable against white (3:1) so a pale brand color never vanishes. */
export function safeAccent(hex: string): string {
  let color = hex.toLowerCase()
  for (let step = 0; step < 12 && contrastWithWhite(color) < 3; step++) {
    const mix = (offset: number) =>
      Math.round(parseInt(color.slice(offset, offset + 2), 16) * 0.85)
        .toString(16)
        .padStart(2, "0")
    color = `#${mix(1)}${mix(3)}${mix(5)}`
  }
  return color
}

/** CSS variables for the share page and embed; empty when the workspace has no accent. */
export function brandStyle(brand: Brand | null | undefined): Record<string, string> | undefined {
  if (!brand?.color || !HEX_COLOR.test(brand.color)) return undefined
  const accent = safeAccent(brand.color)
  return {
    "--brand-accent": accent,
    "--media-accent-color": accent,
    "--media-primary-color": "#ffffff",
    accentColor: accent,
  }
}
