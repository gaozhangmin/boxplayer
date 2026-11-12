export const providers = [
  ['aliyun', '阿里云盘（网页）'], ['alipan-open', '阿里云盘 OpenAPI'], ['baidu', '百度网盘'], ['123', '123 网盘'], ['115', '115'], ['quark', '夸克'], ['pikpak', 'PikPak'], ['onedrive', 'OneDrive'], ['dropbox', 'Dropbox'], ['box', 'Box'], ['google', 'Google Drive'], ['139', '移动云盘'], ['189', '天翼云盘'], ['guangya', '光鸭'], ['smb','SMB'], ['nfs','NFS'], ['ftp','FTP'], ['webdav', 'WebDAV'], ['alist', 'AList'], ['jellyfin', 'Jellyfin'], ['emby', 'Emby'], ['plex', 'Plex'], ['boxplayer', 'BoxPlayer']
] as const
export type ProviderId = typeof providers[number][0]
export interface Account { id: string; providerId: ProviderId; name: string; baseUrl: string; userId?: string; deviceId?: string; authOrigins: string[] }
export interface Credentials { headers: Record<string, string>; refreshToken?: string; expiresAt?: number }
export interface SourceEntry { id: string; name: string; isDirectory: boolean; size: number; playable: boolean; favorite?: boolean; serverType?: string }
export interface SourcePage { entries: SourceEntry[]; nextCursor?: string }
export interface ResolvedMedia { schemaVersion: 1; sourceId: string; accountId: string; fileId: string; url: string; headers: Record<string,string>; expiresAt?: number }
export interface SourceDriver {
  search?(account: Account, query: string, cursor?: string): Promise<SourcePage>
  list(account: Account, parent: string, cursor?: string): Promise<SourcePage>
  resolve(account: Account, entry: SourceEntry): Promise<ResolvedMedia>
}
