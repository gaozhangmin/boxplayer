<script setup lang='ts'>
import {computed,h,ref,onUnmounted,type PropType} from 'vue'
import IconFont from '@/features/files/electron/IconFont.vue'
import {message,useWinStore} from '@/features/files/drive/ports'
import type {IAliShareAnonymous} from '../../aliapi/alimodels'
import {humanExpiration} from '../../utils/format'
import {Tree as AntdTree} from 'ant-design-vue'
import type {EventDataNode} from 'ant-design-vue/es/tree'
import {treeSelectToExpand} from '../../utils/antdtree'
import {HanToPin} from '../../utils/pinyin'
import type {ShareImportUiPort} from '@/features/files/drive/shareImportUiPorts'
let alive=true
const timers=new Set<ReturnType<typeof setTimeout>>()
onUnmounted(()=>{alive=false;for(const timer of timers)clearTimeout(timer);timers.clear()})
function check(){if(!alive)throw Error('分享窗口已关闭');props.port.check()}
function report(error:unknown){if(!alive)return;try{props.port.check();message.error(error instanceof Error?error.message:String(error))}catch{}}
function later(fn:()=>void,delay:number){const timer=setTimeout(()=>{timers.delete(timer);if(alive)fn()},delay);timers.add(timer)}
const modalCloseAll=()=>{check();props.port.close()}
const modalSelectPanDir=(_type:string,_selected:string,callback:(user:string,drive:string,file:any)=>Promise<void>)=>{check();props.port.selectDirectory(async(user,drive,file)=>{try{check();await callback(user,drive,file);check()}catch(error){report(error)}})}
const AliShare={ApiGetShareAnonymous:async(id:string,password:string)=>{check();const result=await props.port.info(id,password);check();return result},ApiGetShareToken:async(id:string,password:string)=>{check();const result=await props.port.token(id,password);check();return result},ApiShareFileList:async(id:string,token:string,parent:string)=>{check();const result=await props.port.list(id,token,parent);check();return result},ApiSaveShareFilesBatch:(id:string,token:string,user:string,drive:string,parent:string,ids:string[])=>{check();return props.port.save(id,token,user,drive,parent,ids)}}
const AliFileCmd={ApiCreatNewForder:(user:string,drive:string,parent:string,name:string)=>{check();return props.port.createFolder(user,drive,parent,name)}}
const PanDAL={aReLoadOneDirToRefreshTree:(user:string,drive:string,parent:string)=>{check();return props.port.refresh(user,drive,parent)}}
interface TreeNodeData {
  key: string
  title: string
  titleSearch: string
  isLeaf: boolean
  children: TreeNodeData[]
  icon: any
  isDir: boolean
  timeStr: string,
  sizeStr: string
}

export interface CheckNode {
  file_id: string
  name: string
  halfChecked: boolean
  isDir: boolean
  children: CheckNode[]
}

const props = defineProps({
  port:{type:Object as PropType<ShareImportUiPort>,required:true},
  visible: {
    type: Boolean,
    required: true
  },
  withsave: {
    type: Boolean,
    required: true
  },
  save_db: {
    type: Boolean,
    required: true
  },
  share_id: {
    type: String,
    required: true
  },
  share_pwd: {
    type: String,
    required: true
  },
  share_token: {
    type: String,
    required: true
  },
  file_id_list: {
    type: Array as PropType<string[]>,
    required: true
  }
})

const iconfolder = h(IconFont, { name: 'iconfile-folder' })
const foldericonfn = () => iconfolder
const fileiconfn = (icon: string) => h(IconFont, { name: icon })
const winStore = useWinStore()
const treeHeight = computed(() => (winStore.height * 8) / 10 - 126)
const okLoading = ref(false)
const share = ref<IAliShareAnonymous | undefined>(undefined)
const expiration = computed(() => (share.value ? humanExpiration(share.value.shareinfo.expiration) : ''))
const share_token = ref('')
const fileList = new Set<string>()
const dirList = new Set<string>()
const isAlbum = ref(false)
const filterKeyword = ref('')
const filterType = ref('file')

const handleOpen = async () => {
 try{
  check();fileList.clear();dirList.clear();props.file_id_list.map(id=>fileList.add(id))
  share.value=await AliShare.ApiGetShareAnonymous(props.share_id,props.share_pwd);check()
  isAlbum.value=share.value.shareinfo.is_photo_collection
  treeExpandedKeys.value=[];treeSelectedKeys.value=[]
  share_token.value=props.share_token||await AliShare.ApiGetShareToken(props.share_id,props.share_pwd);check()
  if(share_token.value.startsWith('，'))throw Error(share_token.value)
  treeData.value=await apiLoad('root');check()
 }catch(error){report(error)}
}

const handleClose = () => {
  if (okLoading.value) okLoading.value = false
  share.value = undefined
  share_token.value = ''
  filterKeyword.value = ''
  fileList.clear()
  dirList.clear()
  treeData.value = []
  treeExpandedKeys.value = []
  copyTreeExpandedKeys.value = []
  treeSelectedKeys.value = []
  treeCheckedKeys.value = []
  pendingLoads.clear();knownParents.clear()
}

const treeref = ref()
const treeData = ref<TreeNodeData[]>([])
const treeExpandedKeys = ref<string[]>([])
const copyTreeExpandedKeys = ref<string[]>([])
const treeSelectedKeys = ref<string[]>([])
const treeCheckedKeys = ref<string[]>([])

const onLoadData = async (treeNode:EventDataNode) => {
 check()
 if(!share_token.value||!treeNode.dataRef||treeNode.dataRef.children?.length)return
 const rows=await apiLoad(treeNode.dataRef.key);check();treeNode.dataRef.children=rows;treeData.value=treeData.value.concat()
}

const autoExpand = (list: TreeNodeData[]) => {
  if (list.length < 4) {
    later(() => {
      for (let i = 0, maxi = list.length; i < maxi; i++) {
        const item = list[i]
        if (!item.isLeaf) {
          apiLoad(item.key).then((addList: TreeNodeData[]) => {
            check()
            item.children = addList
            if (treeData.value) treeData.value = treeData.value.concat()
            if (treeExpandedKeys.value) {
              treeExpandedKeys.value.push(item.key)
              copyTreeExpandedKeys.value.push(item.key)
            }
          }).catch(report)
        }
      }
    }, 200)
  }
}

const pendingLoads=new Map<string,Promise<TreeNodeData[]>>()
const knownParents=new Map<string,string>()
const apiLoad = (key: any):Promise<TreeNodeData[]> => {
  check();key=String(key)
  const pending=pendingLoads.get(key);if(pending)return pending
  const result=AliShare.ApiShareFileList(props.share_id, share_token.value, key as string)
    .then((resp) => {
      check()
      const addList: TreeNodeData[] = []
      if (resp.next_marker == '') {
        for (let i = 0, maxi = resp.items.length; i < maxi; i++) {
          const item = resp.items[i]
          if(item.file_id===key||knownParents.has(item.file_id)&&knownParents.get(item.file_id)!==key)throw Error('分享目录包含重复或循环项目')
          knownParents.set(item.file_id,key)
          if (item.isDir) dirList.add(item.file_id)
          addList.push({
            key: item.file_id,
            title: item.name,
            titleSearch: HanToPin(item.name),
            timeStr: item.timeStr,
            sizeStr: item.sizeStr,
            children: [],
            isDir: item.isDir,
            isLeaf: !item.isDir,
            icon: item.isDir ? foldericonfn : () => fileiconfn(item.icon)
          } as TreeNodeData)
        }
        autoExpand(addList)
      } else {
        message.error('列出分享文件失败：' + resp.next_marker)
      }
      return addList
    })
    .catch(error => {pendingLoads.delete(key);report(error);throw error})
  pendingLoads.set(key,result);return result
}

const handleHide = () => {
  modalCloseAll()
}

const searchData = (keyword: string) => {
  const loop = (data: TreeNodeData[]) => {
    const result: TreeNodeData[] = []
    for (let item of data) {
      if (filterFn(item, keyword)) {
        result.push(item)
      } else if (item.children) {
        const filterData = loop(item.children)
        if (filterData.length) {
          result.push({ ...item, children: filterData })
        }
      }
    }
    return result
  }
  return loop(treeData.value)
}

const filterFn = (data: TreeNodeData, filterText: string) => { //过滤函数
  if (!filterText) {
    return true
  }
  const filter = filterText.toLowerCase()
  if (data.isLeaf && filterType.value === 'file' || data.isDir && filterType.value === 'folder') {
    return data.title.toLowerCase().includes(filter) || data.titleSearch.toLowerCase().includes(filter)
  } else if (filterType.value === 'all') {
    return data.title.toLowerCase().includes(filter) || data.titleSearch.toLowerCase().includes(filter)
  } else {
    return false
  }
}

const expandedKeysFun = (treeData: TreeNodeData[]) => { //展开 key函数
  if (treeData && treeData.length == 0) {
    return []
  }
  let expandKeys: string[] = []
  const expandedKeysFn = (treeData: TreeNodeData[]) => {
    treeData.forEach((item, index) => {
      if (item.isDir) expandKeys.push(item.key)
      if (item.children) expandedKeysFn(item.children)
    })
  }
  expandedKeysFn(treeData)
  return expandKeys
}
const filteredTreeData = computed(() => {
  if (filterKeyword.value == '') {
    return treeData.value
  }
  let filterData = searchData(filterKeyword.value)
  if (filterType.value !== 'folder' && filterData.length > 0) {
    let expandKeys = expandedKeysFun(filterData)
    if (expandKeys.length > 4 && expandKeys[0] == copyTreeExpandedKeys.value[0]) {
      treeExpandedKeys.value = []
    } else {
      treeExpandedKeys.value = expandKeys
    }
  }
  return filterData
})

const handleFilterChange = (val: any) => {
  filterKeyword.value = val
}

const handleOK = (saveType: string) => {
  const checkedKeys = treeref.value.checkedKeys
  const checkedMap = new Map<string, boolean>()
  for (let i = 0, maxi = checkedKeys.length; i < maxi; i++) {
    checkedMap.set(checkedKeys[i].toString(), true)
  }
  const halfCheckedKeys = treeref.value.halfCheckedKeys
  const halfCheckedMap = new Map<string, boolean>()
  for (let i = 0, maxi = halfCheckedKeys.length; i < maxi; i++) {
    halfCheckedMap.set(halfCheckedKeys[i].toString(), true)
  }

  let selectNodes: CheckNode[] = []
  let treeData = filteredTreeData.value
  if (saveType == 'all') {
    for (let i = 0, maxi = treeData.length; i < maxi; i++) {
      const item = treeData[i]
      selectNodes.push({
        file_id: item.key.toString(),
        name: item.title!.toString(),
        isDir: item.isDir,
        halfChecked: false,
        children: []
      } as CheckNode)
    }
  } else if (saveType == 'file') {
    selectNodes = getCheckNodeOnlyFile(treeData, checkedMap, halfCheckedMap)
  } else if (saveType == 'folder') {
    selectNodes = getCheckNode(treeData, checkedMap, halfCheckedMap)
  } else if (saveType == 'fileAndFolder') {
    selectNodes = getCheckNodeFileAndFolder(treeData, checkedMap, halfCheckedMap)
  }

  if(!selectNodes.length){message.warning('请先选择要导入的文件');return}
  check()
  const this_share_id = props.share_id
  const this_share_token = share_token.value
  modalSelectPanDir('share', '', async function(user_id: string, drive_id: string, selectFile: any) {
    check()
    if (!drive_id || !selectFile.drive_id || !selectFile.file_id) return
    const result = await SaveLink(saveType, this_share_id, this_share_token, user_id, selectFile.drive_id, selectFile.file_id, selectNodes)
    check()
    if(result==='async')message.info('已提交转存任务，完成后请手动刷新保存到的文件夹')
    else if (result) message.error('保存文件出错,' + result)
    else message.success('保存文件成功,请稍后手动刷新保存到的文件夹')
    await PanDAL.aReLoadOneDirToRefreshTree(user_id, selectFile.drive_id, selectFile.file_id)
  })
}

const handleOKAlbum = (saveType: string) => {
  message.error('暂不支持导入从相册分享的链接')
}


function getCheckNode(list: TreeNodeData[], checkedMap: Map<string, boolean>, halfCheckedMap: Map<string, boolean>) {
  const selectNodes: CheckNode[] = []
  for (let i = 0, maxi = list.length; i < maxi; i++) {
    const item = list[i]
    const key = list[i].key.toString()
    if (checkedMap.has(key)) {
      checkedMap.delete(key)
      selectNodes.push({
        file_id: key,
        name: item.title!.toString(),
        isDir: item.isDir,
        halfChecked: false,
        children: []
      } as CheckNode)
    } else if (item.children && item.children.length > 0) {
      if (halfCheckedMap.has(key)) {
        halfCheckedMap.delete(key)
        const child = getCheckNode(item.children, checkedMap, halfCheckedMap)
        selectNodes.push({
          file_id: key,
          name: item.title!.toString(),
          isDir: item.isDir,
          halfChecked: true,
          children: child
        } as CheckNode)
      }
    }
  }
  return selectNodes
}


function getCheckNodeOnlyFile(list: TreeNodeData[], checkedMap: Map<string, boolean>, halfCheckedMap: Map<string, boolean>) {
  const selectNodes: CheckNode[] = []
  for (let i = 0, maxi = list.length; i < maxi; i++) {
    const item = list[i]
    const key = list[i].key.toString()
    if (item.isLeaf && checkedMap.has(key)) {
      checkedMap.delete(key)
      selectNodes.push({
        file_id: key,
        name: item.title!.toString(),
        isDir: item.isDir,
        halfChecked: false,
        children: []
      } as CheckNode)
    } else if (item.children && item.children.length > 0) {
      const child = getCheckNodeOnlyFile(item.children, checkedMap, halfCheckedMap)
      for (let j = 0, maxj = child.length; j < maxj; j++) {
        if (!child[j].halfChecked) selectNodes.push(child[j])
      }
    }
  }
  return selectNodes
}

function getCheckNodeFileAndFolder(list: TreeNodeData[], checkedMap: Map<string, boolean>, halfCheckedMap: Map<string, boolean>) {
  const selectNodes: CheckNode[] = []
  for (let i = 0, maxi = list.length; i < maxi; i++) {
    const item = list[i]
    const key = list[i].key.toString()
    if (checkedMap.has(key)) {
      checkedMap.delete(key)
      selectNodes.push({
        file_id: key,
        name: item.title!.toString(),
        isDir: item.isDir,
        halfChecked: false,
        children: []
      } as CheckNode)
    } else if (item.children && item.children.length > 0) {
      if (halfCheckedMap.has(key)) {
        halfCheckedMap.delete(key)
        const child = getCheckNodeFileAndFolder(item.children, checkedMap, halfCheckedMap)
        for (let j = 0, maxj = child.length; j < maxj; j++) {
          if (!child[j].halfChecked) selectNodes.push(child[j])
          else {
            selectNodes.push({
              file_id: key,
              name: item.title!.toString(),
              isDir: item.isDir,
              halfChecked: true,
              children: child
            } as CheckNode)
          }
        }
      }
    }
  }
  return selectNodes
}

async function SaveLink(saveType: string, share_id: string, share_token: string, user_id: string, drive_id: string, parent_file_id: string, nodes: CheckNode[]) {
  check()
  let result = ''
  let pending=false
  const selectKeys: string[] = []
  const halfNodes: CheckNode[] = []
  for (let i = 0, maxi = nodes.length; i < maxi; i++) {
    if (!nodes[i].halfChecked) {
      if (nodes[i].isDir && saveType == 'file') {
        const fileList = await getNodeAllFiles(share_id, share_token, nodes[i].file_id)
        selectKeys.push(...fileList)
      } else {
        selectKeys.push(nodes[i].file_id)
      }
    } else halfNodes.push(nodes[i])
  }

  const save = await AliShare.ApiSaveShareFilesBatch(share_id, share_token, user_id, drive_id, parent_file_id, selectKeys)
  if(save==='async')pending=true
  if (save !== 'success' && save !== 'async') result += ';' + save + ' '
  for (let i = 0, maxi = halfNodes.length; i < maxi; i++) {
    const half = halfNodes[i]
    const data = await AliFileCmd.ApiCreatNewForder(user_id, drive_id, parent_file_id, half.name)
    if (data.file_id) {
      const rchild = await SaveLink(saveType, share_id, share_token, user_id, drive_id, data.file_id, half.children)
      check()
      if(rchild==='async')pending=true
      else if (rchild) result += ';' + rchild + ' '
    } else result += ';创建' + half.name + '失败 ' + data.error
  }

  check()
  return result||(pending?'async':'')
}

async function getNodeAllFiles(share_id: string, share_token: string, file_id: string): Promise<string[]> {
  const fileList: string[] = []
  const resp = await AliShare.ApiShareFileList(share_id, share_token, file_id)
  if (resp.next_marker == '') {
    for (let i = 0, maxi = resp.items.length; i < maxi; i++) {
      const item = resp.items[i]
      if (item.isDir) {
        const temp = await getNodeAllFiles(share_id, share_token, item.file_id)
        fileList.push(...temp)
      } else fileList.push(item.file_id)
    }
  } else {
    message.error('列出分享文件失败：' + resp.next_marker)
  }
  return fileList
}
</script>

<template>
  <a-modal :visible='visible' modal-class='modalclass showsharemodal source-drive-dialog' title-align='start' :footer='false'
           :unmount-on-close='true' :mask-closable='false' @cancel='handleHide'
           @before-open='handleOpen'
           @close='handleClose'>
    <template #title>
      <div class='modaltitle'>
        <span class='sharetime'>[{{ expiration }}]</span>
        <span class='sharetitle'>{{ share?.shareinfo.share_name }}</span>
        <div class='toppanbtn'>
          <a-dropdown style='width: max-content'>
            <a-button>筛选范围</a-button>
            <template #content>
              <a-radio-group v-model="filterType" direction="vertical">
                <a-radio value="all">全部</a-radio>
                <a-radio value="folder">文件夹</a-radio>
                <a-radio value="file">文件</a-radio>
              </a-radio-group>
            </template>
          </a-dropdown>
        </div>
        <div class='toppanbtn' style='margin-right: 35px'>
          <a-input-search
            ref='inputsearch'
            v-model.trim='filterKeyword'
            :input-attrs="{ tabindex: '-1' }"
            size='small'
            title='Ctrl+F / F3 / Space'
            placeholder='快速筛选'
            draggable='false'
            allow-clear
            @dragenter.stop='() => false'
            @clear='(e:any)=>handleFilterChange("")'
            @input='(val:any)=>handleFilterChange(val as string)'
            @keydown.esc=';($event.target as any).blur()' />
        </div>
      </div>
    </template>
    <div class='sharemodalbody'>
      <AntdTree
        ref='treeref'
        v-model:expanded-keys='treeExpandedKeys'
        v-model:selected-keys='treeSelectedKeys'
        v-model:checked-keys='treeCheckedKeys'
        :tree-data='filteredTreeData'
        :load-data='onLoadData'
        :tabindex='-1'
        :focusable='false'
        class='sharetree'
        :checkable='withsave'
        block-node
        selectable
        :auto-expand-parent='false'
        show-icon
        :height='treeHeight'
        :style="{ height: treeHeight + 'px' }"
        :show-line='{ showLeafIcon: false }'
        @select='treeSelectToExpand'>
        <template #switcherIcon>
          <i class='ant-tree-switcher-icon iconfont Arrow' />
        </template>
        <template #title="{ dataRef }">
          <span :class="'sharetitleleft' + (fileList.has(dataRef.key) ? ' new' : '')">
            {{ dataRef?.title }}
          </span>
          <span class='sharetitleright'>{{ dataRef.sizeStr }}</span>
          <span class='sharetitleright'>{{ dataRef.timeStr }}</span>
        </template>
      </AntdTree>
    </div>
    <div v-if='withsave && isAlbum == false' class='modalfoot'>
      <div style='flex-grow: 1'></div>
      <a-button v-if='!okLoading' type='outline' size='small' tabindex='-1' @click='handleHide'>取消</a-button>
      <a-button type='primary' status='success' size='small' tabindex='-1' :loading='okLoading'
                title='按照分享链接内部的路径，导入勾选的文件和文件夹' @click="() => handleOK('folder')">导入勾选(按路径)
      </a-button>
      <a-button type='primary' status='normal' size='small' tabindex='-1' :loading='okLoading'
                title='导入勾选的文件(包含选中的文件夹)' @click="() => handleOK('fileAndFolder')">导入勾选(仅选中文件及文件夹)
      </a-button>
      <a-button type='primary' status='warning' size='small' tabindex='-1' :loading='okLoading'
                title='导入勾选的文件(把所有文件都保存到同一个文件夹里)' @click="() => handleOK('file')">导入勾选(仅文件)
      </a-button>
      <a-button type='primary' status='danger' size='small' tabindex='-1' :loading='okLoading'
                title='一键导入分享链接内全部文件和文件夹' @click="() => handleOK('all')">一键导入全部
      </a-button>
    </div>

  </a-modal>
</template>
<style>
.source-drive-dialog.showsharemodal .arco-modal-header {
  border-bottom: none;
}

.source-drive-dialog.showsharemodal .arco-modal-body {
  padding: 0 16px 16px 16px !important;
}

.source-drive-dialog.showsharemodal .modaltitle {
  width: 80vw;
  max-width: 860px;
  flex-wrap: nowrap;
  display: flex;
  justify-content: center;
}

.source-drive-dialog .showsharetitle {
  max-width: 500px;
  display: flex;
}

.source-drive-dialog.showsharemodal .sharetime {
  font-size: 12px;
  line-height: 25px;
  color: rgb(var(--primary-6));
  flex-grow: 0;
  flex-shrink: 0;
}

.source-drive-dialog.showsharemodal .sharetitle {
  font-size: 16px;
  line-height: 25px;
  flex-grow: 1;
  white-space: nowrap;
  word-break: keep-all;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-right: 32px;
}

.source-drive-dialog .sharemodalbody {
  width: 80vw;
  max-width: 860px;
  height: calc(80vh - 80px);
  padding-bottom: 16px
}

.source-drive-dialog .sharetree {
  border: 1px solid var(--color-neutral-3);
  padding: 4px;
}

.source-drive-dialog .sharetree .ant-tree-icon__customize .iconfont {
  font-size: 18px;
  margin-right: 2px;
}

.source-drive-dialog .sharetree .ant-tree-node-content-wrapper {
  flex: auto;
  display: flex !important;
  flex-direction: row;
}

.source-drive-dialog .sharetree .ant-tree-title {
  flex: auto;
  display: flex !important;
  flex-direction: row;
}

.source-drive-dialog .sharetree .sharetitleleft {
  flex-shrink: 1;
  flex-grow: 1;
  display: -webkit-box;
  max-height: 48px;
  word-break: break-all;
  overflow: hidden;
  text-overflow: ellipsis;
  -webkit-line-clamp: 2;
}

.source-drive-dialog .sharetree .sharetitleleft.new {
  color: rgb(var(--primary-6));
}

.source-drive-dialog .sharetree .sharetitleleft .filter-text {
  color: red;
  font-weight: bold;
}

.source-drive-dialog .sharetree .sharetitleright {
  padding-left: 12px;
  padding-right: 12px;
  font-size: 12px;
  color: var(--color-text-3);
  flex-shrink: 0;
  flex-grow: 0;
}
</style>
