export type DriveCapability = 'list' | 'search' | 'download' | 'upload' | 'createFolder' | 'rename' | 'move' | 'copy' | 'share' | 'recycleBin' | 'directLink' | 'mediaTranscode'
export type DriveOperation =
  | 'files.list' | 'files.search' | 'files.download' | 'files.downloadZip' | 'files.createFolder' | 'files.rename' | 'files.move' | 'files.copy'
  | 'upload.local' | 'upload.memory' | 'upload.encrypted'
  | 'share.create' | 'share.import' | 'share.cancel'
  | 'trash.move' | 'trash.list' | 'trash.restore' | 'trash.delete' | 'trash.empty'
  | 'offline.magnet' | 'offline.http'
  | 'links.direct' | 'media.transcode'
export type CapabilityVerification = 'tested' | 'implemented' | 'unsupported' | 'unknown'

export interface ProviderCapabilityEvidence {
  status: CapabilityVerification
  implementation?: string
  test?: string
  note?: string
}

export interface ProviderCapabilityManifest {
  platform: string
  name: string
  capabilities: Record<DriveCapability, boolean>
  operations: Record<DriveOperation, boolean>
  evidence: Record<DriveCapability, ProviderCapabilityEvidence>
  agentTools: string[]
  notes: string[]
}

const capabilityKeys: DriveCapability[] = ['list', 'search', 'download', 'upload', 'createFolder', 'rename', 'move', 'copy', 'share', 'recycleBin', 'directLink', 'mediaTranscode']

export const operationKeys: DriveOperation[] = ['files.list', 'files.search', 'files.download', 'files.downloadZip', 'files.createFolder', 'files.rename', 'files.move', 'files.copy', 'upload.local', 'upload.memory', 'upload.encrypted', 'share.create', 'share.import', 'share.cancel', 'trash.move', 'trash.list', 'trash.restore', 'trash.delete', 'trash.empty', 'offline.magnet', 'offline.http', 'links.direct', 'media.transcode']

function legacyOperations(capabilities: Record<DriveCapability, boolean>): Record<DriveOperation, boolean> {
  return {
    'files.list': capabilities.list,
    'files.search': capabilities.search,
    'files.download': capabilities.download,
    'files.downloadZip': false,
    'files.createFolder': capabilities.createFolder,
    'files.rename': capabilities.rename,
    'files.move': capabilities.move,
    'files.copy': capabilities.copy,
    'upload.local': capabilities.upload,
    'upload.memory': capabilities.upload,
    'upload.encrypted': false,
    'share.create': capabilities.share,
    'share.import': false,
    'share.cancel': capabilities.share,
    'trash.move': capabilities.recycleBin,
    'trash.list': capabilities.recycleBin,
    'trash.restore': capabilities.recycleBin,
    'trash.delete': capabilities.recycleBin,
    'trash.empty': capabilities.recycleBin,
    'offline.magnet': false,
    'offline.http': false,
    'links.direct': capabilities.directLink,
    'media.transcode': capabilities.mediaTranscode
  }
}

export function defineProviderCapabilities(input: Omit<ProviderCapabilityManifest, 'evidence' | 'agentTools' | 'operations'> & { operations?: Partial<Record<DriveOperation, boolean>>, evidence?: Partial<Record<DriveCapability, ProviderCapabilityEvidence>> }): ProviderCapabilityManifest {
  const evidence = Object.fromEntries(capabilityKeys.map(capability => {
    const enabled = input.capabilities[capability]
    return [capability, input.evidence?.[capability] || { status: enabled ? 'implemented' : 'unsupported' }]
  })) as Record<DriveCapability, ProviderCapabilityEvidence>
  const operations = { ...legacyOperations(input.capabilities), ...input.operations }
  const agentTools = ['listDrives', 'getConnectedDriveCapabilities']
  if (operations['files.search']) agentTools.push('searchMyFiles')
  if (operations['files.list']) agentTools.push('analyzeStorage', 'categorizeFiles')
  if (operations['files.list']) agentTools.push('scanDriveLargeFiles', 'findDuplicates', 'scanDriveEmptyDirs')
  if (operations['files.download']) agentTools.push('downloadFiles')
  if (operations['files.move']) agentTools.push('moveFiles', 'organizeFiles')
  if (operations['trash.move']) agentTools.push('deleteFiles')
  if (operations['links.direct']) agentTools.push('exportDirectLinks')
  return { ...input, operations, evidence, agentTools }
}

export const commonDriveCapabilities: Record<DriveCapability, boolean> = {
  list: true, search: true, download: true, upload: true, createFolder: true, rename: true, move: true, copy: true, share: true, recycleBin: false, directLink: false, mediaTranscode: false
}
