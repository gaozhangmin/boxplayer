import {expect,it} from 'vitest'
import {createPinia} from 'pinia'
import useUploadingStore,{type IUploadingModel} from '@/features/files/drive/electron/down/UploadingStore'
const row=(UploadID:number,TaskID:number):IUploadingModel=>({UploadID,TaskID,localFilePath:'/fixture',name:'fixture',sizeStr:'1 B',icon:'',isDir:false,uploadState:'',speedStr:'',Progress:0,ProgressStr:'',errorMessage:''})
it('isolates task-group and file selection across store instances',()=>{
 const groups=useUploadingStore(createPinia()),files=useUploadingStore(createPinia())
 groups.aLoadListData(0,'',[row(1,101),row(2,102)],2)
 files.aLoadListData(101,'Group',[row(11,101),row(12,101)],2)
 groups.mMouseSelect(102,false,false);files.mMouseSelect(12,false,false)
 expect(groups.GetSelected().map(item=>item.TaskID)).toEqual([102])
 expect(files.GetSelected().map(item=>item.UploadID)).toEqual([12])
 groups.mSelectAll();expect(groups.ListSelected).toEqual(new Set([101,102]))
 expect(files.ListSelected).toEqual(new Set([12]))
})
it('retains surviving numeric selections on refresh and clears them when changing groups',()=>{
 const store=useUploadingStore(createPinia())
 store.aLoadListData(101,'One',[row(11,101),row(12,101)],2)
 store.mMouseSelect(12,false,false)
 store.aLoadListData(101,'One',[row(12,101),row(13,101)],2)
 expect(store.ListSelected).toEqual(new Set([12]))
 store.aLoadListData(102,'Two',[row(21,102)],1)
 expect(store.ListSelected.size).toBe(0);expect(store.ShowTaskName).toBe('Two')
 store.mSelectAll();expect(store.GetSelectedFirst()?.UploadID).toBe(21)
})
it('preserves original shift range and keyboard focus navigation',()=>{
 const store=useUploadingStore(createPinia())
 store.aLoadListData(101,'One',[row(11,101),row(12,101),row(13,101)],3)
 store.mMouseSelect(11,false,false);store.mMouseSelect(13,false,true)
 expect(store.ListSelected).toEqual(new Set([11,12,13]))
 expect(store.mGetFocusNext('prev')).toBe(12)
 store.mDeleteFiles([12]);expect(store.GetSelected().map(item=>item.UploadID)).toEqual([11,13])
})
