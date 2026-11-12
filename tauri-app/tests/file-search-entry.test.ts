import {beforeEach,describe,it,expect,vi} from 'vitest'
const state=vi.hoisted(()=>({tree:{user_id:'source',drive_id:'source',selectDir:{file_id:'root'}},settings:{securityHideBackupDrive:false,securityHideResourceDrive:false,securityHidePicDrive:true},ali:true,supported:true,load:vi.fn(),action:vi.fn(),error:vi.fn(),warning:vi.fn()}))
vi.mock('@/features/files/drive/ports',()=>({usePanTreeStore:()=>state.tree,useSettingStore:()=>state.settings,message:{error:state.error,warning:state.warning},supportsSearch:()=>state.supported,isAliyunUser:()=>state.ali,PanDAL:{aReLoadOneDirToShow:state.load},getDrivePane:()=>({account:{name:'Fixture'},action:state.action})}))
import {topSearchAll} from '@/features/files/drive/electron/pan/topbtns/search'
beforeEach(()=>{vi.clearAllMocks();state.ali=true;state.supported=true;state.settings.securityHideBackupDrive=false})
describe('original Electron search entry',()=>{
 it('opens advanced dialog with original selected range',async()=>{await topSearchAll('topSearchAll高级搜索',['backup','resource']);expect(state.action).toHaveBeenCalledWith('advancedSearch',[['backup','resource']]);expect(state.load).not.toHaveBeenCalled()})
 it('preserves keyword case and excludes hidden physical ranges',async()=>{state.settings.securityHideBackupDrive=true;await topSearchAll('Movie',['backup','resource','pic']);expect(state.load).toHaveBeenCalledWith('','searchMovie range:resource ',false)})
 it('retains original empty-range error',async()=>{await topSearchAll('Movie',[]);expect(state.error).toHaveBeenCalledWith('搜索失败 搜索范围不能为空');expect(state.load).not.toHaveBeenCalled()})
 it('keeps other provider search free from Ali range syntax',async()=>{state.ali=false;await topSearchAll(' Movie ',['backup']);expect(state.load).toHaveBeenCalledWith('','searchMovie',false)})
 it('reports unsupported search without loading a directory',async()=>{state.supported=false;await topSearchAll('Movie',['backup']);expect(state.warning).toHaveBeenCalled();expect(state.load).not.toHaveBeenCalled()})
})
