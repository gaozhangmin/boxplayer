<script setup lang="ts">
import {ref,onUnmounted} from 'vue'
import {modalCloseAll} from '@/features/files/drive/creationPorts'
import {usePanTreeStore,message,PanDAL} from '@/features/files/drive/ports'
import AliFileCmd from '@/features/files/drive/fileCommands'
import {parseFolderNames,createFolderBatch,type FolderCreationResult} from '@/features/files/drive/batchFolders'
const props=defineProps<{visible:boolean;parentdirid?:string}>()
const okLoading=ref(false),folderNames=ref(''),error=ref(''),results=ref<FolderCreationResult[]>([])
const completed=new Map<string,string>(),controller=new AbortController()
onUnmounted(()=>controller.abort())
function handleOpen(){error.value=''}
function handleClose(){}
function handleHide(){if(!okLoading.value)void modalCloseAll()}
async function handleOK(){
 if(okLoading.value)return
 let names:string[]
 try{names=parseFolderNames(folderNames.value)}catch(cause){error.value=cause instanceof Error?cause.message:String(cause);return}
 const tree=usePanTreeStore(),user=tree.user_id,drive=tree.drive_id,parent=props.parentdirid||tree.selectDir.file_id
 if(!user||!drive||!parent){error.value='目标文件夹无效';return}
 error.value='';okLoading.value=true
 try{
  const report=await createFolderBatch(names,name=>AliFileCmd.ApiCreatNewForder(user,drive,parent,name,''),completed,controller.signal)
  if(controller.signal.aborted)return
  results.value=report
  await PanDAL.aReLoadOneDirToShow(drive,'refresh',false)
  if(controller.signal.aborted)return
  const failed=report.filter(result=>result.error).length
  if(!failed){message.success(`已创建 ${report.length} 个文件夹`);await modalCloseAll()}
  else error.value=`${report.length-failed} 个成功，${failed} 个失败。修改名称后可重试，已成功项不会重复创建。`
 }catch(cause){if(!controller.signal.aborted)error.value=cause instanceof Error?cause.message:String(cause)}
 finally{okLoading.value=false}
}
</script>

<template>
  <a-modal :visible="visible" modal-class="modalclass source-drive-dialog" :footer="false" :unmount-on-close="true" :mask-closable="false" @cancel="handleHide" @before-open="handleOpen" @close="handleClose">
    <template #title>
      <span class="modaltitle">批量新建文件夹</span>
    </template>
    <div class="modalbody" style="width: 440px"><label>文件夹名（每行一个）<a-textarea id="batch-folder-names" v-model="folderNames" :disabled="okLoading" :auto-size="{ minRows: 5, maxRows: 12 }" placeholder="每行输入一个文件夹名"/></label><p v-if="error" role="alert">{{error}}</p><ul v-if="results.length"><li v-for="result in results" :key="result.name">{{result.name}}：{{result.error||'已创建'}}</li></ul></div>
    <div class="modalfoot">
      <a-button v-if="!okLoading" type="outline" size="small" @click="handleHide">取消</a-button>
      <a-button type="primary" size="small" :loading="okLoading" @click="handleOK">{{results.some(result=>result.error)?'重试失败项':'创建'}}</a-button>
    </div>
  </a-modal>
</template>

<style></style>
