import { useFileSourcesStore } from '@/stores/fileSources'
import { createPinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises, DOMWrapper } from '@vue/test-utils'
import SourceManager from '@/features/sources/SourceManager.vue'
import { nativeCall } from '@/platform/native'
vi.mock('qrcode',()=>({default:{toDataURL:vi.fn(async()=> 'data:image/png;base64,dGVzdA==')}}))
vi.mock('@/platform/native',()=>({isNative:()=>false,asAppError:(error:unknown)=>({message:String(error)}),nativeCall:vi.fn(async(command:string)=>command==='drive115_begin'||command==='quark_begin'?{sessionId:'test-session',content:'test-qr-content'}:command==='local_list'?{entries:[],parentPath:null,relativePath:''}:true)}))
let wrapper:ReturnType<typeof mount>|undefined
afterEach(()=>{wrapper?.unmount();document.body.innerHTML='';vi.clearAllMocks()})
const providerLabels:Record<string,string>={'115':'115网盘','夸克':'夸克网盘','光鸭':'光鸭云盘','移动云盘':'139云盘','123 网盘':'123网盘'}
async function selectProvider(view:DOMWrapper<Element>,label:string){await view.findAll('button').find(button=>button.text()===(providerLabels[label]||label))!.trigger('click');await flushPromises();const submit=view.find('form button');if(submit.exists()&&submit.text()==='连接'){await view.get('form').trigger('submit');await flushPromises()}}
it('selects 115, creates QR locally with default application config, and cancels on close',async()=>{
 wrapper=mount(SourceManager,{attachTo:document.body,global:{plugins:[createPinia()]}});await flushPromises();const view=new DOMWrapper(document.body)
 await selectProvider(view,'115');await flushPromises()
 expect(view.text()).not.toContain('Client ID（可选，留空使用默认配置）')
 expect(view.findAll('button').some(b=>b.text()==='高级')).toBe(false)
 expect(view.find('input[placeholder="https://server.example/dav/"]').exists()).toBe(false)
 await view.get('form').trigger('submit');await flushPromises()
 expect(nativeCall).toHaveBeenCalledWith('drive115_begin',{clientId:'',clientSecret:null,name:'115'})
 expect(view.find('img[alt="115 登录二维码"]').attributes('src')).toMatch(/^data:/)
 await view.get('button[aria-label="关闭添加来源"]').trigger('click');await flushPromises()
 expect(nativeCall).toHaveBeenCalledWith('drive115_cancel',{sessionId:'test-session'})
 expect(wrapper.emitted('close')).toHaveLength(1)
})

it('Quark uses its own QR session without asking for OAuth client credentials',async()=>{
 wrapper=mount(SourceManager,{attachTo:document.body,global:{plugins:[createPinia()]}});await flushPromises();const view=new DOMWrapper(document.body)
 await selectProvider(view,'夸克');await flushPromises()
 expect(view.text()).not.toContain('Client ID');expect(view.find('input[type="password"]').exists()).toBe(false)
 await view.get('form').trigger('submit');await flushPromises()
 expect(nativeCall).toHaveBeenCalledWith('quark_begin',{name:''});expect(view.find('img[alt="夸克 登录二维码"]').exists()).toBe(true)
 await view.get('button[aria-label="关闭添加来源"]').trigger('click');await flushPromises()
 expect(nativeCall).toHaveBeenCalledWith('quark_cancel',{sessionId:'test-session'})
})

it('opens the provider catalog first and returns from an Emby form without saving',async()=>{
 wrapper=mount(SourceManager,{attachTo:document.body,global:{plugins:[createPinia()]}});await flushPromises();const view=new DOMWrapper(document.body)
 expect(view.text()).toContain('已存储的共享');expect(view.text()).toContain('添加本地文件夹')
 expect(view.find('form').exists()).toBe(false)
 await selectProvider(view,'Emby');await flushPromises()
 expect(view.find('form').exists()).toBe(true);expect(view.text()).toContain('通讯协议')
 await view.get('button[aria-label="返回来源列表"]').trigger('click');await flushPromises()
 expect(view.find('form').exists()).toBe(false);expect(nativeCall).not.toHaveBeenCalledWith('server_login',expect.anything())
})

it('browses a stored local folder inside the dialog without emitting external selection',async()=>{
 const pinia=createPinia();useFileSourcesStore(pinia).replaceSnapshot({localFolders:[{id:'movie',name:'Movie'}],drives:[],mediaServers:[],hasDirectURLs:false})
 wrapper=mount(SourceManager,{attachTo:document.body,global:{plugins:[pinia]}});await flushPromises();const view=new DOMWrapper(document.body)
 await view.get('.saved-source:nth-of-type(3)').trigger('click');await flushPromises();await view.findAll('button').find(b=>b.text()==='Movie')!.trigger('click')
 await flushPromises();expect(wrapper.emitted('select')).toBeUndefined();expect(view.find('[aria-label="已保存来源文件浏览"]').exists()).toBe(true);expect(nativeCall).toHaveBeenCalledWith('local_list',{sourceId:'movie',relativePath:''})
})
it('uses the configured server port and HTTPS mode for native authentication',async()=>{
 wrapper=mount(SourceManager,{attachTo:document.body,global:{plugins:[createPinia()]}});await flushPromises();const view=new DOMWrapper(document.body)
 await selectProvider(view,'Emby');await flushPromises()
 await view.findAll('input')[1]!.setValue('nas.local')
 await view.findAll('button').find(b=>b.text()==='高级')!.trigger('click')
 await view.get('input[placeholder="8096"]').setValue('8920');await view.get('select').setValue('https')
 await view.get('form').trigger('submit');await flushPromises()
 expect(nativeCall).toHaveBeenCalledWith('server_login',expect.objectContaining({providerId:'emby',baseUrl:'https://nas.local:8920',name:'我的 Emby'}))
})

it.each(['百度网盘','123 网盘','OneDrive','Google Drive','Dropbox','Box'])('keeps %s login free of advanced application credentials',async(label)=>{
 wrapper=mount(SourceManager,{attachTo:document.body,global:{plugins:[createPinia()]}});await flushPromises();const view=new DOMWrapper(document.body)
 await selectProvider(view,label);await flushPromises()
 expect(view.text()).not.toMatch(/Client ID|Client Secret|回调端口|高级/)
 expect(view.find('input[type="password"]').exists()).toBe(false)
 await view.get('form').trigger('submit');await flushPromises()
 expect(nativeCall).toHaveBeenCalledWith('oauth_login',expect.objectContaining({clientId:'',clientSecret:null}))
})

it('AList defaults to native password plus optional OTP login',async()=>{
 wrapper=mount(SourceManager,{attachTo:document.body,global:{plugins:[createPinia()]}});await flushPromises();const view=new DOMWrapper(document.body)
 await selectProvider(view,'AList');await flushPromises()
 const inputs=view.findAll('input');await inputs[1]!.setValue('https://nas.test/alist');await inputs[2]!.setValue('test-user');await view.get('input[type="password"]').setValue('synthetic-password');await view.get('input[autocomplete="one-time-code"]').setValue('123456')
 await view.get('form').trigger('submit');await flushPromises()
 expect(nativeCall).toHaveBeenCalledWith('server_login',expect.objectContaining({providerId:'alist',baseUrl:'https://nas.test/alist',username:'test-user',password:'synthetic-password',otpCode:'123456'}))
})

it('Alipan displays the official QR image with no client configuration fields',async()=>{
 wrapper=mount(SourceManager,{attachTo:document.body,global:{plugins:[createPinia()]}});await flushPromises();const view=new DOMWrapper(document.body)
 await selectProvider(view,'阿里云盘');await flushPromises()
 expect(view.text()).not.toMatch(/高级|Client ID|Client Secret/);expect(view.find('input[type="password"]').exists()).toBe(false)
 vi.mocked(nativeCall).mockResolvedValueOnce({sessionId:'alipan-session',imageDataUrl:'data:image/png;base64,c3ludGhldGlj'})
 await view.get('form').trigger('submit');await flushPromises()
 expect(nativeCall).toHaveBeenCalledWith('aliyun_begin',expect.objectContaining({name:''}));expect(view.get('img[alt="阿里云盘 登录二维码"]').attributes('src')).toBe('data:image/png;base64,c3ludGhldGlj')
 await view.get('button[aria-label="关闭添加来源"]').trigger('click');await flushPromises()
 expect(nativeCall).toHaveBeenCalledWith('alipan_cancel',{sessionId:'alipan-session'})
})

it('cancels a QR returned after navigation instead of attaching it to the next provider',async()=>{
 wrapper=mount(SourceManager,{attachTo:document.body,global:{plugins:[createPinia()]}});await flushPromises();const view=new DOMWrapper(document.body)
 await selectProvider(view,'阿里云盘');await flushPromises()
 let resolve!: (value:unknown)=>void
 vi.mocked(nativeCall).mockImplementationOnce(()=>new Promise(done=>{resolve=done}) as never)
 await view.get('form').trigger('submit');await flushPromises()
 await view.get('button[aria-label="返回来源列表"]').trigger('click');await flushPromises()
 resolve({sessionId:'late-alipan',imageDataUrl:'data:image/png;base64,c3ludGhldGlj'});await flushPromises()
 expect(nativeCall).toHaveBeenCalledWith('alipan_cancel',{sessionId:'late-alipan'});expect(view.find('img[alt="阿里云盘 登录二维码"]').exists()).toBe(false)
})

it('Aliyun web login uses its native credential window without exposing token input',async()=>{
 wrapper=mount(SourceManager,{attachTo:document.body,global:{plugins:[createPinia()]}});await flushPromises();const view=new DOMWrapper(document.body)
 await selectProvider(view,'阿里云盘');await flushPromises()
 expect(view.text()).not.toMatch(/Client ID|Client Secret/)
 expect(view.find('input[type="password"]').exists()).toBe(false)
 const account={id:'web-a',providerId:'aliyun',name:'Aliyun',baseUrl:'https://api.aliyundrive.com',authOrigins:['https://api.aliyundrive.com']}
 vi.mocked(nativeCall).mockResolvedValueOnce(account)
 await view.findAll('button').find(b=>b.text()==='使用网页登录')!.trigger('click');await flushPromises()
 expect(nativeCall).toHaveBeenCalledWith('aliyun_login',expect.objectContaining({name:''}));expect(wrapper.emitted('saved')?.[0]).toEqual([account])
})


it('Guangya requests SMS only on submit, then sends the code to native and emits metadata only',async()=>{
 const account={id:'guangya-a',providerId:'guangya',name:'光鸭',baseUrl:'https://api.guangyapan.com',authOrigins:['https://api.guangyapan.com']}
 vi.mocked(nativeCall).mockImplementation(async(command:string)=>command==='guangya_sms'?{sessionId:'sms-session'}:command==='guangya_login'?account:true)
 wrapper=mount(SourceManager,{attachTo:document.body,global:{plugins:[createPinia()]}});await flushPromises();const view=new DOMWrapper(document.body)
 await selectProvider(view,'光鸭');await flushPromises()
 expect(nativeCall).not.toHaveBeenCalledWith('guangya_sms',expect.anything())
 expect(view.text()).not.toMatch(/Client ID|Client Secret|高级/)
 expect(view.find('input[type="password"]').exists()).toBe(false)
 await view.get('input[autocomplete="tel"]').setValue('13812345678')
 await view.get('form').trigger('submit');await flushPromises()
 expect(nativeCall).toHaveBeenCalledWith('guangya_sms',expect.objectContaining({phoneNumber:'13812345678',name:''}))
 await view.get('input[autocomplete="one-time-code"]').setValue('123456')
 await view.get('form').trigger('submit');await flushPromises()
 expect(nativeCall).toHaveBeenCalledWith('guangya_login',expect.objectContaining({sessionId:'sms-session',code:'123456'}))
 expect(wrapper.emitted('saved')?.[0]).toEqual([account])
})
it('closing Guangya cancels the native SMS challenge',async()=>{
 vi.mocked(nativeCall).mockImplementation(async(command:string)=>command==='guangya_sms'?{sessionId:'sms-cancel'}:true)
 wrapper=mount(SourceManager,{attachTo:document.body,global:{plugins:[createPinia()]}});await flushPromises();const view=new DOMWrapper(document.body)
 await selectProvider(view,'光鸭');await flushPromises()
 await view.get('input[autocomplete="tel"]').setValue('13812345678');await view.get('form').trigger('submit');await flushPromises()
 await view.get('button[aria-label="关闭添加来源"]').trigger('click');await flushPromises()
 expect(nativeCall).toHaveBeenCalledWith('guangya_cancel',{sessionId:'sms-cancel'})
})

it('PikPak submits password login natively without cloud advanced configuration',async()=>{
 const account={id:'pikpak-a',providerId:'pikpak',name:'PikPak',baseUrl:'https://api-drive.mypikpak.com',authOrigins:['https://api-drive.mypikpak.com','https://user.mypikpak.com']}
 vi.mocked(nativeCall).mockImplementation(async(command:string)=>command==='pikpak_login'?account:true)
 wrapper=mount(SourceManager,{attachTo:document.body,global:{plugins:[createPinia()]}});await flushPromises();const view=new DOMWrapper(document.body)
 await selectProvider(view,'PikPak');await flushPromises()
 expect(view.text()).not.toMatch(/Client ID|Client Secret|高级/)
 expect(view.find('input[placeholder="https://server.example/dav/"]').exists()).toBe(false)
 await view.findAll('input')[1]!.setValue('synthetic@example.test');await view.get('input[type="password"]').setValue('synthetic-password')
 await view.get('form').trigger('submit');await flushPromises()
 expect(nativeCall).toHaveBeenCalledWith('pikpak_login',expect.objectContaining({name:'',username:'synthetic@example.test',password:'synthetic-password'}))
 expect(wrapper.emitted('saved')?.[0]).toEqual([account]);expect(view.get<HTMLInputElement>('input[type="password"]').element.value).toBe('')
})

it('139 passes Authorization only to its native login and clears it after saving',async()=>{
 const account={id:'139-a',providerId:'139',name:'移动云盘',baseUrl:'https://personal.yun.139.com/hcy',authOrigins:['https://personal.yun.139.com','https://yun.139.com']}
 vi.mocked(nativeCall).mockImplementation(async(command:string)=>command==='cloud139_login'?account:true)
 wrapper=mount(SourceManager,{attachTo:document.body,global:{plugins:[createPinia()]}});await flushPromises();const view=new DOMWrapper(document.body)
 await selectProvider(view,'移动云盘');await flushPromises()
 expect(view.text()).toContain('Authorization');expect(view.text()).not.toMatch(/Client ID|Client Secret|高级/)
 expect(view.findAll('input')).toHaveLength(2)
 await view.get('input[type="password"]').setValue('synthetic-authorization');await view.get('form').trigger('submit');await flushPromises()
 expect(nativeCall).toHaveBeenCalledWith('cloud139_login',expect.objectContaining({name:'',authorization:'synthetic-authorization'}))
 expect(view.get<HTMLInputElement>('input[type="password"]').element.value).toBe('');expect(wrapper.emitted('saved')?.[0]).toEqual([account])
})

it('Tianyi creates QR locally from its own native session and cancels on close',async()=>{
 vi.mocked(nativeCall).mockImplementation(async(command:string)=>command==='cloud189_begin'?{sessionId:'tianyi-session',content:'synthetic-qr-content'}:true)
 wrapper=mount(SourceManager,{attachTo:document.body,global:{plugins:[createPinia()]}});await flushPromises();const view=new DOMWrapper(document.body)
 await selectProvider(view,'天翼云盘');await flushPromises()
 expect(view.text()).not.toMatch(/Client ID|Client Secret|高级/);expect(view.find('input[type="password"]').exists()).toBe(false)
 await view.get('form').trigger('submit');await flushPromises()
 expect(nativeCall).toHaveBeenCalledWith('cloud189_begin',expect.objectContaining({requestId:expect.any(String),name:''}));expect(view.find('img[alt="天翼云盘 登录二维码"]').exists()).toBe(true)
 await view.get('button[aria-label="关闭添加来源"]').trigger('click');await flushPromises()
 expect(nativeCall).toHaveBeenCalledWith('cloud189_cancel',{sessionId:'tianyi-session'})
})


it('keeps cloud connection as a separate step and preserves the original provider ordering',async()=>{
 wrapper=mount(SourceManager,{attachTo:document.body,global:{plugins:[createPinia()]}});await flushPromises();const view=new DOMWrapper(document.body)
 const groups=view.findAll('.source-catalog section');expect(groups[2]!.findAll('button').map(button=>button.text())).toEqual(['Google Drive','Dropbox','OneDrive','Box','阿里云盘','123网盘','115网盘','百度网盘','PikPak','夸克网盘','139云盘','天翼云盘','光鸭云盘'])
 await view.findAll('button').find(button=>button.text()==='Google Drive')!.trigger('click');await flushPromises()
 expect(view.findAll('form input')).toHaveLength(1);expect(view.get('form').text()).toContain('连接');expect(view.find('input[type=password]').exists()).toBe(false)
 await view.get('form').trigger('submit');await flushPromises();expect(view.get('form').text()).toContain('在浏览器登录');expect(nativeCall).not.toHaveBeenCalledWith('oauth_login',expect.anything())
})
it('selects a local folder without persisting it until Save, and scans only after saving',async()=>{
 const choice={id:'pending-folder',path:'/synthetic/Videos',name:'Videos'},scanFolder=vi.fn(async()=>{}),removeFolder=vi.fn(async()=>{})
 vi.mocked(nativeCall).mockImplementation(async command=>command==='local_choose_folder'?choice:command==='local_save_chosen_source'?{id:'local-videos',name:'My videos'}:true)
 wrapper=mount(SourceManager,{attachTo:document.body,props:{folderCatalog:{scanFolder,removeFolder}},global:{plugins:[createPinia()]}});await flushPromises();const view=new DOMWrapper(document.body)
 await view.findAll('button').find(button=>button.text()==='添加本地文件夹')!.trigger('click');await flushPromises()
 expect(view.get('form button[type=submit]').attributes('disabled')).toBeDefined()
 await view.findAll('button').find(button=>button.text()==='选择文件夹')!.trigger('click');await flushPromises()
 expect(nativeCall).not.toHaveBeenCalledWith('local_save_chosen_source',expect.anything());expect(scanFolder).not.toHaveBeenCalled()
 await view.get('form input').setValue('My videos');await view.get('form').trigger('submit');await flushPromises()
 expect(nativeCall).toHaveBeenCalledWith('local_save_chosen_source',{selectionId:choice.id,name:'My videos'});expect(scanFolder).toHaveBeenCalledWith('local-videos','');expect(wrapper.emitted('close')).toHaveLength(1)
})
it('cancels a pending folder selection when leaving the form without adding a source',async()=>{
 vi.mocked(nativeCall).mockImplementation(async command=>command==='local_choose_folder'?{id:'cancel-folder',path:'/synthetic/Videos',name:'Videos'}:true)
 wrapper=mount(SourceManager,{attachTo:document.body,global:{plugins:[createPinia()]}});await flushPromises();const view=new DOMWrapper(document.body)
 await view.findAll('button').find(button=>button.text()==='添加本地文件夹')!.trigger('click');await flushPromises();await view.findAll('button').find(button=>button.text()==='选择文件夹')!.trigger('click');await flushPromises();await view.get('[aria-label="返回来源列表"]').trigger('click');await flushPromises()
 expect(nativeCall).toHaveBeenCalledWith('local_cancel_folder',{selectionId:'cancel-folder'});expect(nativeCall).not.toHaveBeenCalledWith('local_save_chosen_source',expect.anything())
})

it('connects Plex without host fields, selects discovered servers, and only saves on confirmation',async()=>{
 const accounts=[{id:'p1',providerId:'plex',name:'One',baseUrl:'http://localhost:32400',authOrigins:['http://localhost:32400']},{id:'p2',providerId:'plex',name:'Two',baseUrl:'https://plex.example',authOrigins:['https://plex.example']}]
 vi.mocked(nativeCall).mockImplementation(async(command:string)=>command==='plex_login'?{sessionId:'plex-session',resources:[{id:'one',name:'One',connections:2},{id:'two',name:'Two',connections:1}]}:command==='plex_save_resources'?{accounts,failed:0}:true as never)
 wrapper=mount(SourceManager,{attachTo:document.body,global:{plugins:[createPinia()]}});await flushPromises();const view=new DOMWrapper(document.body)
 await view.findAll('button').find(button=>button.text()==='Plex')!.trigger('click');expect(view.find('input[placeholder="iMac.local"]').exists()).toBe(false);expect(view.findAll('button').some(button=>button.text()==='高级')).toBe(false)
 await view.get('form').trigger('submit');await flushPromises();expect(nativeCall).toHaveBeenCalledWith('plex_login',{requestId:expect.any(String)});expect(nativeCall).not.toHaveBeenCalledWith('plex_save_resources',expect.anything());expect(view.findAll('.plex-resource-row')).toHaveLength(2);expect(view.findAll('.plex-resource-row.selected')).toHaveLength(2)
 await view.get('form.plex-modal').trigger('submit');await flushPromises();expect(nativeCall).toHaveBeenCalledWith('plex_save_resources',{sessionId:'plex-session',selected:['one','two'],name:''});expect(wrapper.emitted('saved')?.flat()).toEqual(accounts)
})
it('cancels pending Plex resources when leaving the form and creates no accounts',async()=>{
 vi.mocked(nativeCall).mockImplementation(async(command:string)=>command==='plex_login'?{sessionId:'discard',resources:[{id:'one',name:'One',connections:1}]}:true as never)
 wrapper=mount(SourceManager,{attachTo:document.body,global:{plugins:[createPinia()]}});await flushPromises();const view=new DOMWrapper(document.body)
 await view.findAll('button').find(button=>button.text()==='Plex')!.trigger('click');await view.get('form').trigger('submit');await flushPromises();await view.get('[aria-label="返回来源列表"]').trigger('click');await flushPromises()
 expect(nativeCall).toHaveBeenCalledWith('plex_cancel_resources',{sessionId:'discard'});expect(nativeCall).not.toHaveBeenCalledWith('plex_save_resources',expect.anything());expect(wrapper.emitted('saved')).toBeUndefined()
})
