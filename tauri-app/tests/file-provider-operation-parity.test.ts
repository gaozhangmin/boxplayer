import {expect,it} from 'vitest'
import type {Account} from '@/features/sources/contracts'
import {electronProviderCapabilities} from '@/features/files/adapters/providerCapabilities'
import {supportsRemoteFolderCreation} from '@/features/files/drive/folderMutations'
import {supportsRemoteRename} from '@/features/files/drive/renameMutations'
import {supportsRemoteRelocation,supportsRemoteCopy} from '@/features/files/drive/relocationMutations'
import {supportsRemoteTextCreation} from '@/features/files/drive/textCreation'
import {supportsRemoteTrash,supportsRemoteTrashMove,supportsRemoteTrashRestore,supportsRemoteTrashDelete,supportsRemoteTrashEmpty} from '@/features/files/drive/trashMutations'
import {supportsSourceShare} from '@/features/sources/share'
import type {DriveOperation} from '@/features/files/electron/drive/services/agent/providerCapabilityTypes'
// Open Ali is a separate OAuth protocol, not evidence that web-channel operations exist.
// Local physical mutations and M6 transfer engines are explicitly outside this matrix.
const providers:Account['providerId'][]=['aliyun','123','115','139','189','baidu','guangya','pikpak','quark','dropbox','onedrive','box','google','webdav','alist']
const checks:[DriveOperation,(account:Account)=>boolean][]=[['files.createFolder',supportsRemoteFolderCreation],['files.rename',supportsRemoteRename],['files.move',supportsRemoteRelocation],['files.copy',supportsRemoteCopy],['upload.memory',supportsRemoteTextCreation],['trash.move',supportsRemoteTrashMove],['trash.list',supportsRemoteTrash],['trash.restore',supportsRemoteTrashRestore],['trash.delete',supportsRemoteTrashDelete],['trash.empty',supportsRemoteTrashEmpty],['share.create',supportsSourceShare]]
it.each(providers)('retains every declared M5 operation for %s and does not enable undeclared writes',providerId=>{
 const account:Account={id:'parity-fixture',providerId,name:'Fixture',baseUrl:'',authOrigins:[]}
 const declared=electronProviderCapabilities(account)!
 for(const [operation,available] of checks)expect(available(account),providerId+':'+operation).toBe(declared.operations[operation])
})
