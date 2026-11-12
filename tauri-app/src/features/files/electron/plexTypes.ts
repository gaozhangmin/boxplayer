export interface PlexPin {
  id: number
  code: string
  clientIdentifier: string
  expiresIn: number
  authToken?: string | null
}

export interface PlexConnection {
  uri?: string | null
  address?: string | null
  protocol?: string | null
  port?: number | null
  local: boolean
  relay: boolean
}

export interface PlexResource {
  name: string
  provides?: string | null
  product?: string | null
  owned?: boolean
  accessToken?: string | null
  clientIdentifier?: string | null
  connections: PlexConnection[]
}
