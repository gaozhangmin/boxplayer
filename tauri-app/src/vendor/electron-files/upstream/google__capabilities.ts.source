import { commonDriveCapabilities, defineProviderCapabilities } from '../services/agent/providerCapabilityTypes'

export default defineProviderCapabilities({
  platform: 'google', name: 'Google Drive', capabilities: { ...commonDriveCapabilities, upload: true, recycleBin: true },
  operations: { 'upload.memory': true, 'upload.local': true, 'files.createFolder': true, 'files.rename': true, 'files.move': true, 'files.copy': true, 'trash.move': true, 'trash.restore': true, 'trash.delete': true, 'share.create': true },
  notes: ['支持 Drive v3 文件浏览、搜索、可续传上传、回收站、公开只读分享及媒体库扫描。'],
  evidence: { list: { status: 'implemented', implementation: 'src/google/dirfilelist.ts' }, upload: { status: 'implemented', implementation: 'src/google/upload.ts' }, share: { status: 'implemented', implementation: 'src/google/share.ts' }, move: { status: 'implemented', implementation: 'src/google/filecmd.ts' }, recycleBin: { status: 'implemented', implementation: 'src/google/filecmd.ts' } }
})
