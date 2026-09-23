import path from 'path'

export function resolveCloudDriveCliConfigDir(configuredDir: string | undefined, homeDir: string): string {
  const explicit = String(configuredDir || '').trim()
  return explicit ? path.resolve(explicit) : path.join(homeDir, '.clouddrive-cli')
}
