import { commonDriveCapabilities, defineProviderCapabilities } from '../services/agent/providerCapabilityTypes'

export default defineProviderCapabilities({
  platform: 'aliyun', name: '阿里云盘', capabilities: { ...commonDriveCapabilities, recycleBin: true, directLink: true, mediaTranscode: true }, notes: [],
  operations: { 'upload.encrypted': true, 'share.import': true },
  evidence: {
    list: { status: 'implemented', implementation: 'src/aliapi/dirfilelist.ts' },
    upload: { status: 'implemented', implementation: 'src/aliapi/upload.ts' },
    share: { status: 'implemented', implementation: 'src/aliapi/share.ts' },
    move: { status: 'implemented', implementation: 'src/aliapi/filecmd.ts' }
  }
})
