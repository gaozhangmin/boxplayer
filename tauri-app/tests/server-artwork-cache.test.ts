import {expect,it,vi} from 'vitest'
vi.mock('@/platform/native',()=>({isNative:()=>true,nativeCall:vi.fn()}))
import {serverArtwork} from '@/features/sources/serverMetadata'
import {nativeCall} from '@/platform/native'
it('uses an account-bound native cache and creates only a local Blob URL',async()=>{vi.stubGlobal('URL',class extends URL{static createObjectURL=vi.fn(()=> 'blob:synthetic-artwork')});vi.mocked(nativeCall).mockResolvedValue('data:image/png;base64,iVBORw0KGgo=');const account={id:'server-a',providerId:'jellyfin' as const,name:'Fixture',baseUrl:'https://fixture.invalid',authOrigins:[]};expect(await serverArtwork(account,'Items/a/Images/Primary?tag=v1')).toBe('blob:synthetic-artwork');expect(nativeCall).toHaveBeenCalledWith('server_artwork',{accountId:'server-a',path:'Items/a/Images/Primary?tag=v1'});await expect(serverArtwork(account,'https://other.invalid/image')).rejects.toThrow();vi.unstubAllGlobals()})
