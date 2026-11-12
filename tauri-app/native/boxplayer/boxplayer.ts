/** What the renderer hands the main-process boxplayer host right before it runs a task. */
export interface BoxPlayerRuntimeConfig {
  /** OpenAI-compatible endpoint; null when no AI model is configured. */
  model: { baseURL: string; apiKey: string; modelId: string; providerName: string } | null
  /** BoxPlayer API origin: PanSou search at /api/search, TMDB at /api/tmdb/proxy. */
  boxplayerApiBaseURL: string
}

/** The drive and folder a task lands in. Each distinct folder is one boxplayer connected storage. */
export interface BoxPlayerDriveTarget {
  id: string
  platform: string
  userId: string
  driveId: string
  folderId: string
  preferredLanguage?: string
  preferredQuality?: string
  createdAt: number
}
