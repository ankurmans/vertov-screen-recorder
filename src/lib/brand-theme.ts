// Workspace branding is not part of this edition: share pages use the default look.
export interface Brand {
  color: string | null
  logo: string | null
  name: string
}

export const brandStyle = (_brand: Brand | null | undefined): undefined => undefined
