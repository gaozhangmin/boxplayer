<script setup lang='ts'>
import { modalCloseAll } from '@/features/files/drive/creationPorts'
import { computed, h, PropType, reactive, ref, onUnmounted } from 'vue'
import IconFont from '@/features/files/electron/IconFont.vue'
import { useSettingStore, useWinStore, message } from '@/features/files/drive/ports'
import { CheckFileName, ClearFileName } from '@/features/files/drive/creationPorts'
import { Tree as AntdTree } from 'ant-design-vue'
import AliFileCmd from '@/features/files/drive/fileCommands'
import { treeSelectToExpand } from '../../utils/antdtree'
import { IAliGetDirModel } from '../../aliapi/alimodels'
import {createDirectoryPickerPorts,TreeNodeData,fileiconfn} from '@/features/files/drive/directoryPickerPorts'
const iconfolder = h(IconFont, { name: 'iconfile-folder' })
const foldericonfn = () => iconfolder


const props = defineProps({
  visible: {
    type: Boolean,
    required: true
  },
  selecttype: {
    type: String,
    required: true
  },
  selectid: {
    type: String,
    required: true
  },
  initialUserId: {
    type: String,
    default: ''
  },
  initialDriveId: {
    type: String,
    default: ''
  },
  category: {
    type: String,
    required: false
  },
  extFilter: {
    type: RegExp,
    required: false
  },
  callback: {
    type: Function as PropType<(user_id: string, drive_id: string, selectFile: any) => void>
  }
})

const dialogAlive=ref(true)
const picker=createDirectoryPickerPorts(row=>{
 if(row.isDir)return true
 if(props.selecttype!=='select')return false
 if(props.category&&row.category!==props.category)return false
 if(props.extFilter){props.extFilter.lastIndex=0;if(!props.extFilter.test(row.ext))return false}
 return true
})
const {TreeStore,PanDAL,GetDriveType,GetDriveID,isSingleRootDriveUser}=picker
onUnmounted(()=>{dialogAlive.value=false;picker.dispose()})
const isScopedDrivePicker = () => props.selecttype === 'selectdir' && !!props.initialUserId && !!props.initialDriveId && !isSingleRootDriveUser(user_id.value)

const okLoading = ref(false)
const ready = ref(false)
const pantreeStore = picker.tree
const winStore = useWinStore()
const treeHeight = computed(() => (winStore.height * 8) / 10 - 126)

const title = ref('')
const user_id = ref('')
const drive_id = ref('')
const selectFile = ref({
  drive_id: pantreeStore.backup_drive_id,
  name: '备份盘',
  file_id: 'backup_root',
  parent_file_id: '',
  path: '',
  description: '',
  isDir: true
})

const handleOpen = async () => {
  if (props.selecttype == 'copy') title.value = '复制文件到. . .  '
  if (props.selecttype == 'cut') title.value = '移动文件到. . .  '
  if (props.selecttype == 'share') title.value = '保存分享文件到. . .  '
  if (props.selecttype == 'unzip') title.value = '解压文件保存到. . .  '
  if (props.selecttype == 'select') title.value = '选择一个文件. . .  '
  if (props.selecttype == 'selectdir') title.value = '选择保存目录. . .  '
  ready.value=false
  okLoading.value=true
  try{await picker.prepare(props.selectid||localStorage.getItem('selectpandir-'+picker.tree.drive_id)||'')}catch{if(dialogAlive.value){message.error('读取来源目录失败，请重试');treeData.value=[];okLoading.value=false}return}
  if(!dialogAlive.value)return
  okLoading.value = true
  user_id.value = props.initialUserId || pantreeStore.user_id
  drive_id.value = props.initialDriveId || pantreeStore.drive_id
  const isSingleRootDrive = isSingleRootDriveUser(user_id.value)
  const isScopedDrive = isScopedDrivePicker()
  const driveType = GetDriveType(user_id.value, drive_id.value)
  const expandedKeys: string[] = isSingleRootDrive || isScopedDrive ? [driveType.key] : ['backup_root', 'resource_root']
  let selectid = props.selectid || localStorage.getItem('selectpandir-' + drive_id.value) || ''
  if(selectid&&!TreeStore.GetDirPath(drive_id.value,selectid).length)selectid=''
  if (selectid) {
    let backup_data: IAliGetDirModel[] = []
    let resource_data: IAliGetDirModel[] = []
    let data: IAliGetDirModel[] = []
    if (isSingleRootDrive || isScopedDrive) {
      const cloudDriveId = GetDriveID(user_id.value, driveType.key) || drive_id.value
      data = TreeStore.GetDirPath(cloudDriveId, selectid)
    } else {
      if (!useSettingStore().securityHideResourceDrive) {
        backup_data = TreeStore.GetDirPath(pantreeStore.backup_drive_id, selectid)
      }
      if (!useSettingStore().securityHideResourceDrive) {
        resource_data = TreeStore.GetDirPath(pantreeStore.resource_drive_id, selectid)
      }
      data = [...backup_data, ...resource_data]
    }
    if (data && data.length > 0) {
      for (let i = 0, maxi = data.length; i < maxi; i++) {
        const item = data[i]
        expandedKeys.push(item.file_id)
        if (item.file_id == selectid) {
          props.selecttype == 'select' && expandedKeys.pop()
          selectFile.value = {
            drive_id: item.drive_id,
            name: item.name,
            file_id: item.file_id,
            parent_file_id: item.parent_file_id,
            path: item.path || '',
            description: item.description,
            isDir: true
          }
        }
      }
    }
    treeSelectedKeys.value = [selectid]
    setTimeout(() => {
      if(!dialogAlive.value)return
      treeref.value?.treeRef?.scrollTo({ key: selectid, offset: 100, align: 'top' })
    }, 400)
  } else {
    if (isSingleRootDrive || isScopedDrive) {
      selectFile.value = {
        drive_id: drive_id.value,
        name: driveType.title,
        file_id: driveType.key,
        parent_file_id: '',
        path: driveType.key === 'baidu_root' ? '/' : '',
        description: '',
        isDir: true
      }
      treeSelectedKeys.value = [driveType.key]
    } else {
      selectFile.value = {
        drive_id: pantreeStore.backup_drive_id,
        name: '备份盘',
        file_id: 'backup_root',
        parent_file_id: '',
        path: '',
        description: '',
        isDir: true
      }
      treeSelectedKeys.value = ['backup_root']
    }
  }
  treeExpandedKeys.value = expandedKeys
  // 网盘数据
  const flag = props.selecttype === 'select'
  if (isSingleRootDrive || isScopedDrive) {
    const cloudDriveId = GetDriveID(user_id.value, driveType.key) || drive_id.value
    treeData.value = PanDAL.GetPanTreeAllNode(user_id.value, cloudDriveId, treeExpandedKeys.value, !flag, flag)
  } else {
    let backupPan: TreeNodeData[] = []
    let resourcePan: TreeNodeData[] = []
    if (!useSettingStore().securityHideBackupDrive) {
      backupPan = PanDAL.GetPanTreeAllNode(user_id.value, pantreeStore.backup_drive_id, treeExpandedKeys.value, !flag, flag)
    }
    if (!useSettingStore().securityHideResourceDrive) {
      resourcePan = PanDAL.GetPanTreeAllNode(user_id.value, pantreeStore.resource_drive_id, treeExpandedKeys.value, !flag, flag)
    }
    treeData.value = [...backupPan, ...resourcePan]
  }
  okLoading.value = false
  ready.value=true
}

const handleClose = () => {
  ready.value=false
  if (okLoading.value) okLoading.value = false
  user_id.value = ''
  drive_id.value = ''
  const driveType = GetDriveType(pantreeStore.user_id, pantreeStore.drive_id)
  selectFile.value = {
    drive_id: pantreeStore.drive_id || pantreeStore.backup_drive_id,
    name: driveType.title,
    file_id: driveType.key,
    parent_file_id: '',
    path: driveType.key === 'baidu_root' ? '/' : '',
    description: '',
    isDir: true
  }
  if (isSingleRootDriveUser(pantreeStore.user_id)) {
    treeData.value = [{
      __v_skip: true,
      key: driveType.key,
      drive_id: pantreeStore.drive_id,
      parent_file_id: '',
      title: driveType.title,
      namesearch: '',
      isLeaf: false,
      icon: foldericonfn,
      children: []
    }]
  } else {
    treeData.value = [{
      __v_skip: true,
      key: 'backup_root',
      parent_file_id: '',
      title: '备份盘',
      namesearch: '',
      isLeaf: false,
      icon: foldericonfn,
      children: []
    }, {
      __v_skip: true,
      key: 'resource_root',
      parent_file_id: '',
      title: '资源盘',
      namesearch: '',
      isLeaf: false,
      icon: foldericonfn,
      children: []
    }]
  }
  treeExpandedKeys.value = []
  treeSelectedKeys.value = []
}

const treeref = ref()
const treeData = ref<TreeNodeData[]>(PanDAL.GetPanTreeAllNode(picker.tree.user_id,picker.tree.drive_id,[]))

const treeExpandedKeys = ref<string[]>([])
const treeSelectedKeys = ref<string[]>([])

const replaceTreeNodeChildren = (nodes: TreeNodeData[], key: string, children: TreeNodeData[]): TreeNodeData[] => {
  return nodes.map((node) => {
    if (String(node.key) === key) return { ...node, isLeaf: false, children }
    if (!node.children?.length) return node
    return { ...node, children: replaceTreeNodeChildren(node.children, key, children) }
  })
}

const handleTreeSelect = async (keys: any[], info: {
  event: string;
  selected: Boolean;
  nativeEvent: MouseEvent;
  node: any
}) => {
  if (!info?.node) return
  let { key, title, isLeaf, isDir, description, parent_file_id } = info.node
  const getParentNode = (node: any): any => {
    return node.parent ? getParentNode(node.parent) : node
  }
  const parentNode = getParentNode(info.node)
  const drive_id = GetDriveID(user_id.value, parentNode.key || key)
  localStorage.setItem('selectpandir-' + drive_id, key)
  selectFile.value = {
    drive_id: drive_id,
    name: title,
    file_id: key,
    parent_file_id: parent_file_id,
    path: info.node.path || '',
    description: description,
    // selectdir 在加载阶段只保留目录；不要依赖 Ant Tree 包装节点丢失的目录字段。
    isDir: props.selecttype === 'selectdir' || (typeof isDir === 'boolean' ? isDir : !isLeaf)
  }
  treeSelectedKeys.value = [key]
  const shouldLoadSingleRootChildren = isSingleRootDriveUser(user_id.value) && (props.selecttype !== 'select' || isDir === true || isLeaf === false)
  if (shouldLoadSingleRootChildren) {
    const children = await apiLoad(key)
    if(!dialogAlive.value)return
    treeData.value = replaceTreeNodeChildren(treeData.value, String(key), children)
    if (!treeExpandedKeys.value.includes(key)) treeExpandedKeys.value = treeExpandedKeys.value.concat(key)
    return
  }
  treeSelectToExpand(keys, info)
}

const apiLoad = async (key: any):Promise<TreeNodeData[]> => {
  if(!dialogAlive.value)return []
  try{const children=await picker.load(String(key));if(!dialogAlive.value)return [];autoExpand(children);return children}
  catch{if(dialogAlive.value)message.error('读取目录失败，请重试');return []}
}

const autoExpand = (list: TreeNodeData[]) => {
  if (list.length < 4) {
    setTimeout(() => {
      if(!dialogAlive.value)return
      for (let i = 0, maxi = list.length; i < maxi; i++) {
        const item = list[i]
        if (item.isLeaf == false) {
          apiLoad(item.key).then((addList: TreeNodeData[]) => {
            if(!dialogAlive.value)return
            item.children = addList
            if (treeData.value) treeData.value = treeData.value.concat()
            if (treeExpandedKeys.value) treeExpandedKeys.value.push(item.key)
          })
        }
      }
    }, 200)
  }
}

const onLoadData = (treeNode: any) => {
  return new Promise<void>((resolve) => {
    if (!treeNode.dataRef) {
      resolve()
      return
    }
    let key = treeNode.dataRef.key
    apiLoad(key).then((addList: TreeNodeData[]) => {
      if(!dialogAlive.value){resolve();return}
      treeNode.dataRef!.children = addList
      if (treeData.value) treeData.value = treeData.value.concat()
      resolve()
    })
  })
}

const handleTreeExpand = (keys: any[], info: {
  node: any;
  expanded: boolean;
  nativeEvent: MouseEvent
}) => {
  const arr = treeExpandedKeys.value
  let { key } = info.node
    if (arr.includes(key)) {
      treeExpandedKeys.value = arr.filter((t) => t != key)
    } else {
      treeExpandedKeys.value = arr.concat([key])
      if (isScopedDrivePicker()) {
        // 资源盘目标目录由 Ant Tree 懒加载；替换整棵缓存树会让当前事件节点失效。
        return
      } else if (props.selecttype !== 'select' && props.selecttype !== 'offline' && !isSingleRootDriveUser(user_id.value)) { // 仅显示文件夹
        let backupPan: TreeNodeData[] = []
        let resourcePan: TreeNodeData[] = []
        if (!useSettingStore().securityHideBackupDrive) {
          backupPan = PanDAL.GetPanTreeAllNode(user_id.value, pantreeStore.backup_drive_id, treeExpandedKeys.value)
        }
        if (!useSettingStore().securityHideResourceDrive) {
          resourcePan = PanDAL.GetPanTreeAllNode(user_id.value, pantreeStore.resource_drive_id, treeExpandedKeys.value)
        }
        treeData.value = [...backupPan, ...resourcePan]
    }
  }
}


const showCreatNewDir = ref(false)
const formRef = ref()
const form = reactive({ dirName: '' })
const rules = [
  { required: true, message: '文件夹名必填' },
  { minLength: 1, message: '文件夹名不能为空' },
  { maxLength: 100, message: '文件夹名太长(100)' },
  {
    validator: (value: string, cb: any) => {
      const chk = CheckFileName(value)
      if (chk) cb('文件夹名' + chk)
    }
  }
]
const handleCloseNewDir = () => {
  if (okLoading.value) okLoading.value = false
  formRef.value.resetFields()
}

const handleHide = () => {
  modalCloseAll()
  if (props.selecttype === 'select') {
    if (props.callback) {
      props.callback(user_id.value, drive_id.value, selectFile.value)
    }
  }
}
const handleCreatNew = () => {
  showCreatNewDir.value = true
  setTimeout(() => {
    if(dialogAlive.value)document.getElementById('SelectDirCreatNewDirInput')?.focus()
  }, 200)
}
const handleHideNewDir = () => {
  showCreatNewDir.value = false
}
const handleOKNewDir = async () => {
  if(okLoading.value||!dialogAlive.value)return
  okLoading.value=true
  try{
    if(await formRef.value.validate())return
    const newName=ClearFileName(form.dirName)
    if(!newName)throw Error('文件夹名不能为空')
    const parent=selectFile.value.file_id
    const result=await AliFileCmd.ApiCreatNewForder(user_id.value,drive_id.value,parent,newName)
    if(result.error||!result.file_id)throw Error(result.error||'创建结果缺少文件夹标识')
    if(!dialogAlive.value)return
    await picker.load(parent)
    if(!dialogAlive.value)return
    treeData.value=PanDAL.GetPanTreeAllNode(user_id.value,drive_id.value,treeExpandedKeys.value)
    selectFile.value={drive_id:drive_id.value,name:newName,file_id:result.file_id,parent_file_id:parent,path:'',description:'',isDir:true}
    treeExpandedKeys.value=Array.from(new Set([...treeExpandedKeys.value,parent]))
    treeSelectedKeys.value=[result.file_id]
    if(picker.isCurrentDirectory(parent))await PanDAL.aReLoadOneDirToShow(drive_id.value,'refresh',false)
    if(!dialogAlive.value)return
    message.success('新建文件夹 成功');showCreatNewDir.value=false
  }catch(cause){if(dialogAlive.value)message.error('新建文件夹失败：'+(cause instanceof Error?cause.message:'请重试'))}
  finally{if(dialogAlive.value)okLoading.value=false}
}

const handleOK = () => {
  if(okLoading.value||!dialogAlive.value)return
  if(!ready.value){message.error('目录尚未加载，请重新打开后重试');return}
  if (props.selecttype === 'select' && selectFile.value.isDir) {
    message.error('请选择一个文件')
    return
  }
  if ((props.selecttype === 'offline' || props.selecttype === 'selectdir') && !selectFile.value.isDir) {
    message.error('请选择一个文件夹')
    return
  }
  modalCloseAll()
  if (props.callback) {
    props.callback(user_id.value, drive_id.value, selectFile.value)
  }
}

</script>

<template>
  <a-modal :visible='visible' modal-class='modalclass showpandirmodal source-drive-dialog'
           :footer='false'
           :unmount-on-close='true'
           :mask-closable='false'
           @cancel='handleHide'
           @before-open='handleOpen'
           @close='handleClose'>
    <template #title>
      <span class='modaltitle'>{{ title }} {{ selecttype !== 'select' && selecttype !== 'selectdir' ? '选择一个位置' : '' }}</span>
    </template>
    <div class='pandirmodalbody'>
      <AntdTree
        ref='treeref'
        :tabindex='-1'
        :focusable='false'
        class='pandirtree'
        block-node
        selectable
        :auto-expand-parent='false'
        show-icon
        :height='treeHeight'
        :style="{ height: treeHeight + 'px' }"
        :item-height='30'
        :show-line='{ showLeafIcon: false }'
        :expanded-keys='treeExpandedKeys'
        :selected-keys='treeSelectedKeys'
        :tree-data='treeData'
        :load-data='onLoadData'
        @select='handleTreeSelect'
        @expand='handleTreeExpand'>
        <template #switcherIcon>
          <IconFont class="ant-tree-switcher-icon ant-tree-switcher-lucide" name="iconArrow-Right2" :size="15" />
        </template>
        <template #icon>
          <IconFont name="iconfile-folder" />
        </template>
        <template #title='{ dataRef }'>
          <span class='sharetitleleft'>{{ dataRef.title }}</span>
        </template>
      </AntdTree>
    </div>
    <div id='selectdir'>已选择：{{ selectFile.name }}</div>
    <div class='modalfoot'>
      <a-button v-if="selecttype !== 'select'" type='outline' size='small' @click='handleCreatNew'>新建文件夹</a-button>
      <div style='flex-grow: 1'></div>
      <a-button v-if='!okLoading' type='outline' size='small' tabindex='-1' @click='handleHide'>取消</a-button>
      <a-button type='primary' size='small' tabindex='-1' :loading='okLoading' @click='handleOK'>选择</a-button>
    </div>
  </a-modal>

  <a-modal :visible='showCreatNewDir' modal-class='modalclass source-drive-dialog' :footer='false' :unmount-on-close='true'
           :mask-closable='false' @cancel='handleHideNewDir' @close='handleCloseNewDir'>
    <template #title>
      <span class='modaltitle'>新建文件夹</span>
    </template>
    <div class='modalbody' style='width: 440px'>
      <a-form ref='formRef' :model='form' layout='vertical'>
        <a-form-item field='dirName' :rules='rules'>
          <template #label>文件夹名：<span class='opblue' style='margin-left: 16px; font-size: 12px'> 不要有特殊字符 &lt; > : * ? \\ / \' " </span>
          </template>
          <a-input v-model.trim='form.dirName' placeholder='例如：新建文件夹' allow-clear
                   :input-attrs="{ id: 'SelectDirCreatNewDirInput', autofocus: 'autofocus' }" />
        </a-form-item>
      </a-form>
      <br />
    </div>
    <div class='modalfoot'>
      <div style='flex-grow: 1'></div>
      <a-button v-if='!okLoading' type='outline' size='small' @click='handleHideNewDir'>取消</a-button>
      <a-button type='primary' size='small' :loading='okLoading' @click='handleOKNewDir'>创建</a-button>
    </div>
  </a-modal>
</template>

<style>
.source-drive-dialog #selectdir {
  text-align: left;
  margin-bottom: 8px;
  font-size: 14px;
  line-height: 18px;
  overflow: hidden;
  -o-text-overflow: ellipsis;
  text-overflow: ellipsis;
  white-space: nowrap;
  word-break: keep-all;
  color: var(--color-text-3);
  height: 18px;
  width: 80vw;
}

.source-drive-dialog.showpandirmodal .arco-modal-header {
  border-bottom: none;
}

.source-drive-dialog.showpandirmodal .arco-modal-body {
  width: 80vw;
  max-width: 860px;
  margin-left: 16px;
  overflow: hidden;
  padding: 0 16px 16px 16px !important;
}

.source-drive-dialog .pandirmodalbody {
  padding-bottom: 16px
}

.source-drive-dialog.showpandirmodal .modaltitle {
  width: 80vw;
  max-width: 860px;
  flex-wrap: nowrap;
  display: flex;
  justify-content: center;
}

.source-drive-dialog .pandirtree {
  border: 1px solid var(--color-neutral-3);
  padding: 4px;
}

.source-drive-dialog .pandirtree .ant-tree-icon__customize .iconfont {
  font-size: 18px;
  margin-right: 2px;
}

.source-drive-dialog .pandirtree .ant-tree-node-content-wrapper {
  flex: auto;
  display: flex !important;
  flex-direction: row;
}

.source-drive-dialog .pandirtree .ant-tree-title {
  flex: auto;
  display: flex !important;
  flex-direction: row;
}

.source-drive-dialog .pandirtree .sharetitleleft {
  flex-shrink: 1;
  flex-grow: 1;
  display: -webkit-box;
  max-height: 48px;
  word-break: break-all;
  overflow: hidden;
  text-overflow: ellipsis;
  -webkit-line-clamp: 2;
}

.source-drive-dialog .pandirtree .sharetitleleft.new {
  color: rgb(var(--primary-6));
}

.source-drive-dialog .pandirtree .sharetitleright {
  padding-left: 12px;
  padding-right: 12px;
  font-size: 12px;
  color: var(--color-text-3);
  flex-shrink: 0;
  flex-grow: 0;
}
</style>
