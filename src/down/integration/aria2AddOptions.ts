export interface BuildAriaAddOptionsInput {
  gid: string
  dir: string
  split: number
  referer: string
  userAgent: string
  headers: string[]
  outFileName: string
  sourceType: string
  selectFile?: string
  allProxy?: string
}

export const buildAriaAddOptions = (input: BuildAriaAddOptionsInput): Record<string, any> => {
  const isBtSource = input.sourceType === 'magnet' || input.sourceType === 'torrent' || input.sourceType === 'torrent-url'
  const options: Record<string, any> = {
    gid: input.gid,
    dir: input.dir,
    split: input.split
  }

  if (!isBtSource) {
    options.out = input.outFileName
    if (input.referer) options.referer = input.referer
    if (input.userAgent) options['user-agent'] = input.userAgent
    if (input.headers.length) options.header = input.headers
  }

  if (input.allProxy) options['all-proxy'] = input.allProxy
  if (isBtSource && input.selectFile) options['select-file'] = input.selectFile
  if (input.sourceType === 'torrent-url') options['follow-torrent'] = 'mem'
  return options
}

export const shouldCheckExistingDownloadTarget = (sourceType: string): boolean =>
  !['magnet', 'torrent', 'torrent-url'].includes(sourceType)

/** Baidu dlinks depend on the account's current token and may expire without an OSS expiry field. */
export const shouldReuseAriaDownloadUrl = (isBaiduAccountDownload: boolean, isExternalSource: boolean): boolean =>
  !isBaiduAccountDownload || isExternalSource

/** Quark and 115 signed URLs bind request context and must not be split by aria2. */
export const resolveProviderDownloadSplit = (provider: string, configuredSplit: number): number =>
  provider === 'quark' || provider === 'drive115' ? 1 : configuredSplit
