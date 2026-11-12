<script setup lang='ts'>
import { usePanFileStore, usePanTreeStore, useSettingStore } from '../../store'
import message from '../../utils/message'
import { modalCloseAll, modalPassword, modalRename } from '../../utils/modal'
import { CheckFileName, ClearFileName } from '../../utils/filehelper'
import { nextTick, reactive, ref } from 'vue'
import { IAliGetFileModel } from '../../aliapi/alimodels'
import AliFileCmd from '../../aliapi/filecmd'
import AliAlbum from '../../aliapi/album'
import PanDAL from '../pandal'
import { getEncType } from '../../utils/proxyhelper'
import { EncodeEncName, isCloud123User } from '../../aliapi/utils'
import { apiCloud123Rename } from '../../cloud123/filecmd'

const props = defineProps({
  visible: {
    type: Boolean,
    required: true
  },
  istree: {
    type: Boolean,
    required: true
  },
  ispic: {
    type: Boolean,
    required: true
  }
})

const okLoading = ref(false)
const encType = ref('')
const isShare = ref(false)
const formRef = ref()

const form = reactive({
  file_id: '',
  parent_file_id: '',
  isDir: false,
  fileName: '',
  description: '',
  bakName: ''
})

let fileList: IAliGetFileModel[] = []

const handleOpen = () => {
  setTimeout(() => {
    document.getElementById('RenameInput')?.focus()
  }, 200)

  if (props.istree) {
    const pantreeStore = usePanTreeStore()
    fileList = [{
      ...pantreeStore.selectDir,
      isDir: true,
      ext: '',
      category: '',
      icon: '',
      sizeStr: '',
      timeStr: '',
      starred: false,
      thumbnail: ''
    } as IAliGetFileModel]
  } else {
    const panfileStore = usePanFileStore()
    fileList = panfileStore.GetSelected()
    if (fileList.length == 0) {
      const focus = panfileStore.mGetFocus()
      panfileStore.mKeyboardSelect(focus, false, false)
      fileList = panfileStore.GetSelected()
    }
  }
  if (fileList.length == 0) {
    form.file_id = ''
    form.parent_file_id = ''
    form.isDir = false
    form.fileName = ''
    form.description = ''
    form.bakName = ''
    nextTick(() => {
      modalCloseAll()
    })
  } else {
    let file = fileList[0]
    isShare.value = file.from_share_id !== undefined
    form.file_id = file.file_id
    form.parent_file_id = file.parent_file_id
    form.isDir = file.isDir
    form.fileName = file.name
    form.description = file.description
    form.bakName = file.name
  }
}

const handleClose = () => {
  if (okLoading.value) okLoading.value = false
  formRef.value.resetFields()
}

const file_rules = [
  { required: true, message: '文件名必填' },
  { minLength: 1, message: '文件夹不能为空' },
  { maxLength: 100, message: '文件夹太长(100)' },
  {
    validator: (value: string, cb: any) => {
      const chk = CheckFileName(value)
      if (chk) cb('文件名' + chk)
    }
  }
]

const album_rules = [
  { required: true, message: '相册名必填' },
  { minLength: 1, message: '相册名不能为空' },
  { maxLength: 100, message: '相册名太长(100)' },
  {
    validator: (value: string, cb: any) => {
      const chk = CheckFileName(value)
      if (chk) cb('相册名' + chk)
    }
  }
]

const handleMulti = () => {
  modalRename(props.istree, true, props.ispic)
}

const handleHide = () => {
  modalCloseAll()
}

const handleOK = () => {
  formRef.value.validate((data: any) => {
    if (data) return
    let newName = ClearFileName(form.fileName)
    if (!newName) {
      message.error(`重命名失败 ${props.ispic ? '相册名' : '文件名'}不能为空`)
      return
    }
    if (newName == form.bakName) {
      modalCloseAll()
      return
    }
    const pantreeStore = usePanTreeStore()
    if (!pantreeStore.user_id || !pantreeStore.drive_id || !pantreeStore.selectDir.file_id) {
      message.error(`重命名失败 ${props.ispic ? '相册文件夹' : '父文件夹'} 错误`)
      return
    }
    okLoading.value = true
    encType.value = getEncType({ description: form.description })
    if (encType.value) {
      if (isShare.value) {
        modalPassword('input', (success, inputpassword) => {
          success && handleRename(newName, encType.value, inputpassword)
        })
      } else if (!useSettingStore().securityPassword) {
        modalPassword('new', (success) => {
          success && handleRename(newName, encType.value)
        })
      } else if (useSettingStore().securityPassword && useSettingStore().securityPasswordConfirm) {
        modalPassword('confirm', (success) => {
          success && handleRename(newName, encType.value)
        })
      } else {
        handleRename(newName, encType.value)
      }
    } else {
      handleRename(newName)
    }
  })
}

const handleRename = (newName: string, encType: string = '', inputpassword: string = '') => {
  const pantreeStore = usePanTreeStore()
  if (!props.ispic) {
    let encName = newName
    if (encType) {
      encName = EncodeEncName(pantreeStore.user_id, newName, form.isDir, encType, inputpassword)
    }
    const renamePromise = isCloud123User(pantreeStore.user_id || '')
      ? apiCloud123Rename(pantreeStore.user_id, form.file_id, encName).then((res) => {
        if (!res.success) return []
        return [{ file_id: form.file_id, parent_file_id: '', name: encType ? newName : encName, isDir: form.isDir }]
      })
      : AliFileCmd.ApiRenameBatch(pantreeStore.user_id, pantreeStore.drive_id, [form.file_id], [encName])

    renamePromise
      .then((data: any) => {
        if (data.length == 1) {
          if (encType && data[0]) data[0].name = newName
          usePanTreeStore().mRenameFiles(data)
          if (!props.istree) usePanFileStore().mRenameFiles(data)
          PanDAL.RefreshPanTreeAllNode(pantreeStore.drive_id)
          message.success('重命名 成功')
        } else {
          message.error('重命名 失败')
        }
      })
      .catch((err: any) => {
        message.error('重命名 失败', err)
      })
      .then(() => {
        modalCloseAll()
      })
  } else {
    let album_id = form.file_id
    let description = form.description
    if (encType) {
      okLoading.value = false
      message.error('相册加密文件无法重命名，需要移动到其他盘修改')
      return
    }
    AliAlbum.ApiAlbumUpdate(pantreeStore.user_id, album_id, newName, description)
      .then((data) => {
        if (data) {
          PanDAL.aReLoadOneDirToShow(pantreeStore.drive_id, 'refresh', false, album_id)
          message.success('相册重命名 成功')
        } else {
          message.error('相册重命名 失败')
        }
      })
      .catch((err: any) => {
        message.error('相册重命名 失败', err)
      })
      .then(() => {
        modalCloseAll()
      })
  }
}
</script>

<template>
  <a-modal :visible='visible' modal-class='modalclass' :footer='false' :unmount-on-close='true' :mask-closable='false'
           @cancel='handleHide' @before-open='handleOpen' @close='handleClose'>
    <template #title>
      <span class='modaltitle'>{{ ispic ? '重命名相册' : '重命名一个文件' }}</span>
    </template>
    <div class='modalbody' style='width: 440px'>
      <a-form ref='formRef' :model='form' layout='vertical'>
        <a-form-item field='fileName' :rules='ispic ? album_rules : file_rules'>
          <template #label>
            {{ ispic ? '相册名' : '文件名' }}：
            <span class='opblue' style='margin-left: 16px; font-size: 12px'> 不要有特殊字符 &lt; > : * ? \\ / \' " </span>
          </template>
          <a-input v-model='form.fileName' :placeholder='form.bakName' allow-clear
                   :input-attrs="{ id: 'RenameInput', autofocus: 'autofocus' }" />
        </a-form-item>
        <a-form-item v-if='ispic' field='description' label='相册描述：' class='textareafill'>
          <a-textarea v-model='form.description' placeholder='修改相册描述' show-word-limit
                      @keydown='(e:any) => e.stopPropagation()' :disabled="encType!=''" />
        </a-form-item>
      </a-form>
      <br />
    </div>
    <div class='modalfoot'>
      <a-button type='outline' size='small' @click='handleMulti' v-if='!ispic'>批量重命名</a-button>
      <div style='flex-grow: 1'></div>
      <a-button v-if='!okLoading' type='outline' size='small' @click='handleHide'>取消</a-button>
      <a-button type='primary' size='small' :loading='okLoading' @click='handleOK'>重命名</a-button>
    </div>
  </a-modal>
</template>

<style></style>
