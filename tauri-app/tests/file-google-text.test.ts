import {expect,it,vi} from 'vitest'
import {json,request} from '@/features/sources/transport'
import {createRemoteText,supportsRemoteTextCreation} from '@/features/files/drive/textCreation'
vi.mock('@/features/sources/transport',()=>({json:vi.fn(),request:vi.fn(),rawRequest:vi.fn(),text:vi.fn()}))
it('rejects Google Drive text creation without requesting metadata or uploading',async()=>{
 const account={id:'readonly-fixture',providerId:'google' as const,name:'Fixture',baseUrl:'',authOrigins:[]}
 expect(supportsRemoteTextCreation(account)).toBe(false)
 await expect(createRemoteText(account,'','电影.txt','内容')).rejects.toThrow('新建文本接口尚未接入')
 expect(json).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled()
})
