<script setup lang="ts">
import './dialogs.css'
import './antdTree.css'
import './batchTabs.css'
import './batchHeader.css'
import './batchLayout.css'
import {ref,computed,watch,nextTick,onUnmounted} from 'vue'
import SearchPan from './electron/pan/topbtns/SearchPanModal.vue'
import CreateFolder from './electron/pan/topbtns/CreatNewDirModal.vue'
import CreateFolderBatch from './electron/pan/topbtns/CreatNewDirMultiModal.vue'
import RenameFile from './electron/pan/topbtns/RenameModal.vue'
import RenameMulti from './electron/pan/topbtns/RenameMultiModal.vue'
import SelectDirectory from './electron/pan/topbtns/SelectPanDirModal.vue'
import CreateText from './electron/pan/topbtns/CreatNewFileModal.vue'
import CreateShare from './electron/pan/topbtns/CreatNewShareLinkModal.vue'
import DownloadConfirm from './electron/pan/topbtns/DownloadModal.vue'
import FileProperties from './electron/pan/topbtns/ShuXingModal.vue'
import ImportShare from './electron/pan/topbtns/DaoRuShareLinkModal.vue'
import ShowShare from './electron/pan/topbtns/ShowShareLinkModal.vue'
import type {ShareImportUiPort} from './shareImportUiPorts'
import CopyFileTree from './electron/pan/topbtns/CopyFileTreeModal.vue'
export interface DriveDialog {kind:'download'|'search'|'createFolder'|'createText'|'createFolderBatch'|'rename'|'renameMulti'|'selectDirectory'|'copyTree'|'properties'|'createShare'|'importShare'|'showShare';downloadZip?:boolean;searchRange?:string[];underlay?:DriveDialog;importPort?:ShareImportUiPort;share?:{id:string;password:string;token:string};resolved?:(value:{id:string;password:string;token:string})=>void;sharetype?:string;driveType?:string;files?:import('./electron/aliapi/alimodels').IAliGetFileModel[];type?:string;parent?:string;callback?:(id:string)=>void;picker?:{type:string;selected:string;user:string;drive:string;callback:(user:string,drive:string,file:any)=>void}}
const props=defineProps<{dialog?:DriveDialog}>()
const visible=ref(false)
let generation=0,showGeneration=0
const showing=computed(()=>props.dialog?.kind==='showShare'?props.dialog:props.dialog?.underlay?.kind==='showShare'?props.dialog.underlay:undefined)
const showVisible=ref(false)
watch(showing,async value=>{const current=++showGeneration;showVisible.value=false;await nextTick();if(current===showGeneration&&value)showVisible.value=true},{immediate:true,flush:'sync'})
// Electron's modal manager mounts a hidden modal before toggling visible. Preserve
// that lifecycle so the original before-open handlers initialize dates and names.
watch(()=>props.dialog,async dialog=>{
 const current=++generation
 visible.value=false
 await nextTick()
 if(current===generation&&dialog)visible.value=true
},{immediate:true,flush:'sync'})
onUnmounted(()=>{generation++;showGeneration++})
</script>
<template><SearchPan v-if="dialog?.kind==='search'" :visible="visible" :inputsearch-type="dialog.searchRange||[]"/><CreateFolder v-else-if="dialog?.kind==='createFolder'" :visible="visible" :dirtype="dialog.type||'folder'" enc-type="" :parentdirid="dialog.parent" :callback="dialog.callback"/><CreateFolderBatch v-else-if="dialog?.kind==='createFolderBatch'" :visible="visible" :parentdirid="dialog.parent"/><SelectDirectory v-else-if="dialog?.kind==='selectDirectory'&&dialog.picker" :visible="visible" :selecttype="dialog.picker.type" :selectid="dialog.picker.selected" :initial-user-id="dialog.picker.user" :initial-drive-id="dialog.picker.drive" :callback="dialog.picker.callback"/><ImportShare v-else-if="dialog?.kind==='importShare'&&dialog.importPort" :visible="visible" :port="dialog.importPort" share-url="" share-pwd="" @resolved="dialog.resolved?.($event)"/><CreateShare v-else-if="dialog?.kind==='createShare'" :visible="visible" :filelist="dialog.files||[]" :sharetype="dialog.sharetype||'s'" :drive-type="dialog.driveType||''"/><DownloadConfirm v-else-if="dialog?.kind==='download'" :visible="visible" :istree="false"/><FileProperties v-else-if="dialog?.kind==='properties'" :visible="visible" :istree="false" :ispic="false"/><CopyFileTree v-else-if="dialog?.kind==='copyTree'" :visible="visible" :filelist="dialog.files||[]"/><RenameMulti v-else-if="dialog?.kind==='renameMulti'" :visible="visible" :istree="false"/><RenameFile v-else-if="dialog?.kind==='rename'" :visible="visible" :istree="false" :ispic="false"/><CreateText v-else-if="dialog?.kind==='createText'" :visible="visible" enc-type=""/><ShowShare v-if="showing?.importPort&&showing.share" :visible="showVisible" :port="showing.importPort" :share_id="showing.share.id" :share_pwd="showing.share.password" :share_token="showing.share.token" :withsave="true" :save_db="false" :file_id_list="[]"/></template>
<style>
/* Native host boundary: retain original desktop dimensions, cap only at viewport edges. */
.arco-modal.source-drive-dialog:not(.renamemulti){width:auto!important;max-width:calc(100vw - 32px)}.source-drive-dialog .modalbody{box-sizing:border-box;max-width:calc(100vw - 64px)!important;overflow:auto}.source-drive-dialog.renamemulti .modalbody{max-width:100vw!important}.source-drive-dialog .opblue{color:rgb(var(--primary-6))}
</style>
