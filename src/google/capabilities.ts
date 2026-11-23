import { commonDriveCapabilities, defineProviderCapabilities } from '../services/agent/providerCapabilityTypes'

export default defineProviderCapabilities({
  platform: 'google',
  name: 'Google Drive',
  capabilities: { ...commonDriveCapabilities, upload: false, createFolder: false, rename: false, move: false, copy: false, share: false },
  operations: { 'trash.list': true },
  notes: ['支持 Drive v3 文件浏览、搜索、下载、只读查看回收站及媒体库扫描。'],
  evidence: { list: { status: 'implemented', implementation: 'src/google/dirfilelist.ts' }, recycleBin: { status: 'implemented', implementation: 'src/google/dirfilelist.ts', note: '只读查看，不支持恢复或删除。' } }
})
