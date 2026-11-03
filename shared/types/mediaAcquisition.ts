export type MediaAcquisitionRunKind = 'movie' | 'season' | 'missing' | 'patrol'
export type MediaAcquisitionRunStatus = 'reserved' | 'queued' | 'searching' | 'selecting' | 'transferring' | 'verifying' | 'organizing' | 'retry_wait' | 'completed' | 'partial' | 'no_coverage' | 'failed' | 'cancelled'
export type MediaAcquisitionPhase = 'queued' | 'search' | 'select' | 'transfer' | 'verify' | 'organize' | 'finalize'

export interface MediaAcquisitionSeasonTarget {
  seasonNumber: number
  missingEpisodes: number[]
}

export interface MediaAcquisitionTarget {
  id: string
  mediaKey: string
  mediaLibraryItemId?: string
  tmdbId?: number
  mediaType: 'movie' | 'tv' | 'anime'
  title: string
  alternativeTitles?: string[]
  year?: number
  seasonNumber?: number
  missingEpisodes?: number[]
  /** One sandbox task may cover gaps in several seasons. */
  seasonTargets?: MediaAcquisitionSeasonTarget[]
  targetUserId: string
  targetDriveId: string
  targetPlatform: string
  targetParentFileId: string
  preferredQuality?: string
  fetchSubtitles: boolean
  preferredLanguage?: string
  trackingEnabled: boolean
  createdAt: number
}

export interface MediaAcquisitionRequest {
  mediaLibraryItemId?: string
  tmdbId?: number
  mediaType: 'movie' | 'tv' | 'anime'
  title: string
  alternativeTitles?: string[]
  year?: number
  releaseDate?: string
  seasonNumber?: number
  missingSeasonNumbers?: number[]
  missingEpisodes?: Array<{ seasonNumber: number; missingEpisodes: number[] }>
  trackingOnly?: boolean
  trackingSeasonNumbers?: number[]
}

export interface MediaAcquisitionRun {
  id: string
  targetId: string
  kind: MediaAcquisitionRunKind
  status: MediaAcquisitionRunStatus
  phase: MediaAcquisitionPhase
  progress: number
  activity: string
  attemptCount: number
  searchAttemptCount: number
  nextAttemptAt?: number
  startedAt: number
  finishedAt?: number
  errorCode?: string
  errorMessage?: string
}

export interface MediaAcquisitionEvent {
  id: string
  runId: string
  level: 'info' | 'warning' | 'error'
  phase: MediaAcquisitionPhase
  message: string
  data?: Record<string, unknown>
  createdAt: number
}

export interface MediaAcquisitionNotification {
  id: string
  runId: string
  mediaKey: string
  title: string
  status: 'completed' | 'partial' | 'no_coverage' | 'failed' | 'cancelled'
  message: string
  read: boolean
  createdAt: number
}

export interface MediaAcquisitionFileSnapshot {
  id: string
  name: string
  path: string
  size?: number
  parentId?: string
}

export type MediaAcquisitionCandidateKind = 'share' | 'magnet' | 'http'
export type MediaAcquisitionCandidateStatus = 'pending' | 'selected' | 'transferring' | 'imported' | 'rejected' | 'failed'

export interface MediaAcquisitionCandidate {
  id: string
  runId: string
  kind: MediaAcquisitionCandidateKind
  sourcePlatform: string
  title: string
  detail?: string
  status: MediaAcquisitionCandidateStatus
  externalTaskId?: string
  externalFileId?: string
  lastError?: string
  selectedAt?: number
  updatedAt?: number
  createdAt: number
}

export interface MediaAcquisitionDecision {
  id: string
  runId: string
  candidateId?: string
  decision: 'select' | 'reject' | 'retry' | 'no_coverage'
  reason: string
  createdAt: number
}

export interface MediaAcquisitionTrackingItem {
  id: string
  targetId: string
  tmdbId?: number
  title: string
  mediaType: 'tv' | 'anime'
  seasonNumber: number
  totalEpisodes: number
  latestAiredEpisode: number
  obtainedEpisodes: number
  obtainedEpisodeNumbers: number[]
  providerAheadEpisodes: number[]
  missingEpisodes: number[]
  status: 'tracking' | 'complete' | 'ended'
  lastCheckedAt?: number
  nextCheckAt?: number
}

export interface CreateMediaAcquisitionTrackingInput {
  mediaLibraryItemId?: string
  tmdbId: number
  mediaType: 'tv' | 'anime'
  title: string
  alternativeTitles?: string[]
  year?: number
  seasonNumber: number
  targetUserId: string
  targetDriveId: string
  targetPlatform: string
  targetParentFileId: string
  preferredQuality?: string
  fetchSubtitles?: boolean
  preferredLanguage?: string
}

export interface CreateMediaAcquisitionCandidateInput {
  kind: MediaAcquisitionCandidateKind
  sourcePlatform: string
  title: string
  locator: string
  password?: string
  detail?: string
}

export interface MediaAcquisitionRunView extends MediaAcquisitionRun {
  target: MediaAcquisitionTarget
  /** The folder the files were organized into (a season or movie folder), when known. */
  landingFolderId?: string
  events: MediaAcquisitionEvent[]
  candidates: MediaAcquisitionCandidate[]
  decisions?: MediaAcquisitionDecision[]
}

export type MediaAcquisitionState = Pick<MediaAcquisitionRun, 'id' | 'status' | 'phase' | 'progress' | 'activity' | 'finishedAt'> & { mediaKey: string; title: string; mediaType: MediaAcquisitionTarget['mediaType']; targetUserId: string; targetDriveId: string; targetParentFileId: string }

export interface CreateMediaAcquisitionRunInput {
  existingTargetId?: string
  force?: boolean
  kind: MediaAcquisitionRunKind
  mediaLibraryItemId?: string
  tmdbId?: number
  mediaType: MediaAcquisitionTarget['mediaType']
  title: string
  alternativeTitles?: string[]
  year?: number
  releaseDate?: string
  seasonNumber?: number
  missingEpisodes?: number[]
  seasonTargets?: MediaAcquisitionSeasonTarget[]
  targetUserId: string
  targetDriveId: string
  targetPlatform: string
  targetParentFileId: string
  preferredQuality?: string
  fetchSubtitles?: boolean
  preferredLanguage?: string
  trackingEnabled?: boolean
}
