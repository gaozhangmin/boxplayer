<script setup lang='ts'>
import {reactive,ref,onUnmounted,type PropType} from 'vue'
import {message} from '@/features/files/drive/ports'
import type {ShareImportUiPort} from '@/features/files/drive/shareImportUiPorts'
import {parseQuarkShareLink} from '../../providers/quarkShare'
import {parseGuangyaShareLink} from '../../providers/guangyaShare'
import {parsePikPakShareLink} from '../../providers/pikpakShare'
const emit=defineEmits<{resolved:[value:{id:string;password:string;token:string}]}>()
let alive=true
let focusTimer:ReturnType<typeof setTimeout>|undefined
onUnmounted(()=>{alive=false;if(focusTimer)clearTimeout(focusTimer)})
function check(){if(!alive)throw Error('导入窗口已关闭');props.port.check()}
const getFromClipboard=async()=>{try{return await navigator.clipboard.readText()}catch{return ''}}
const modalCloseAll=()=>{check();props.port.close()}
const AliShare={ApiGetShareToken:async(id:string,password:string)=>{check();const result=await props.port.token(id,password);check();return result}}
const modalShowShareLink=(id:string,password:string,token:string,..._rest:unknown[])=>{check();emit('resolved',{id,password,token})}
const props = defineProps({
  port:{type:Object as PropType<ShareImportUiPort>,required:true},
  visible: {
    type: Boolean,
    required: true
  },
  shareUrl: {
    type: String,
    required: true
  },
  sharePwd: {
    type: String,
    required: true
  }
})
const okLoading = ref(false)
const formRef = ref()
const save_db = ref(false)
const form = reactive({ sharelink: '', password: '' })

const FixFormate = (text: string, enmpty: boolean) => {
  let linkTxt = ''
  let linkPwd = ''
  const quark = parseQuarkShareLink(text || '')
  if (quark.id) {
    return { linkTxt: `pan.quark.cn/s/${quark.id.replace('quark:', '')}`, linkPwd: quark.pwd }
  }
  const guangya = parseGuangyaShareLink(text || '')
  if (guangya.id) {
    return { linkTxt: `guangyapan.com/s/${guangya.id.replace('guangya:', '')}`, linkPwd: guangya.pwd }
  }
  const pikpak = parsePikPakShareLink(text || '')
  if (pikpak.id) {
    return { linkTxt: `mypikpak.com/s/${pikpak.id.replace('pikpak:', '')}`, linkPwd: pikpak.pwd }
  }
  if (text && text.indexOf('密码') >= 0) text = text.replaceAll('密码', '提取码')
  if (text && text.indexOf('提取码') >= 0) {
    text = text.replace('提取码:', '提取码').replace('提取码：', '提取码').replace('提取码 ', '提取码').trim()
    linkPwd = text.substr(text.indexOf('提取码') + '提取码'.length, 4)
  }

  if (text && text.length == 11) {
    linkTxt = 'aliyundrive.com/s/' + text
  }

  if (text && text.indexOf('aliyundrive.com/s/') >= 0) {
    linkTxt = 'aliyundrive.com/s/' + text.substr(text.indexOf('aliyundrive.com/s/') + 'aliyundrive.com/s/'.length, 11)
  }
  if (text && text.indexOf('alipan.com/s/') >= 0) {
    linkTxt = 'alipan.com/s/' + text.substr(text.indexOf('alipan.com/s/') + 'alipan.com/s/'.length, 11)
  }

  if (!linkTxt && !enmpty) linkTxt = text
  return { linkTxt, linkPwd }
}

const onPaste = async (e: any) => {
  e.stopPropagation()
  e.preventDefault()
  const text = e.clipboardData?.getData('text/plain') || await getFromClipboard()
  check()
  const link = FixFormate(text, true)
  form.sharelink = link.linkTxt
  form.password = link.linkPwd
}
const handleOpen = async () => {
  focusTimer=setTimeout(() => {
    if(!alive)return
    document.getElementById('DaoRuShareInput')?.focus()
  }, 200)
  if (!props.shareUrl.length) {
    const text=await getFromClipboard();if(!alive)return;props.port.check();if(form.sharelink||form.password)return
    let link = FixFormate(text, true)
    form.sharelink = link.linkTxt
    form.password = link.linkPwd
  } else {
    form.sharelink = props.shareUrl
    form.password = props.sharePwd
  }
}
const handleHide = () => {
  modalCloseAll()
}
const handleOK = () => {
  if(okLoading.value)return
  check()
  formRef.value.validate((data: any) => {
    if(!alive)return
    if (data) return
    let sharelink = form.sharelink
    const quark = parseQuarkShareLink(sharelink + (form.password ? ` 提取码:${form.password}` : ''))
    const guangya = parseGuangyaShareLink(sharelink + (form.password ? ` 提取码:${form.password}` : ''))
    const pikpak = parsePikPakShareLink(sharelink + (form.password ? ` 提取码:${form.password}` : ''))
    if (sharelink.indexOf('aliyundrive.com/s/') < 0 && sharelink.indexOf('alipan.com/s/') < 0 && !quark.id && !guangya.id && !pikpak.id) {
      message.error('解析链接出错，必须为阿里云盘、夸克网盘、光鸭云盘或 PikPak 分享链接')
      return
    }

    okLoading.value = true
    const share_id = guangya.id || quark.id || pikpak.id || sharelink.split(/\.com\/s\/([\w]+)/)[1]
    AliShare.ApiGetShareToken(share_id, guangya.pwd || quark.pwd || pikpak.pwd || form.password)
      .then((share_token) => {
        check()
        okLoading.value = false
        if (!share_token || share_token.startsWith('，')) {
          message.error('解析链接出错' + share_token)
        } else {
          modalShowShareLink(share_id, guangya.pwd || quark.pwd || pikpak.pwd || form.password, share_token, true, [], save_db.value)
        }
      })
      .catch((err: any) => {
        if(!alive)return
        try{props.port.check()}catch{return}
        okLoading.value = false
        message.error('解析链接出错', err)
      })
  })
}
const handleClose = () => {
  if (okLoading.value) okLoading.value = false
  formRef.value?.resetFields()
}
</script>

<template>
  <a-modal :visible='visible' modal-class='modalclass source-drive-dialog importsharemodal' :footer='false' :unmount-on-close='true' :mask-closable='false'
           @cancel='handleHide' @before-open='handleOpen' @close='handleClose'>
    <template #title>
      <span class='modaltitle'>导入分享链接</span>
    </template>
    <div class='modalbody' style='width: 440px'>
      <a-form ref='formRef' :model='form' layout='horizontal' auto-label-width>
        <a-form-item
          field='sharelink'
          label='分享链接：'
          :rules="[
            { required: true, message: '分享链接必填' },
            { maxLength: 300, message: '分享链接太长(300)' },
            { match: /((aliyundrive|alipan)\.com|pan\.quark\.cn|guangyapan\.com|(?:my)?pikpak\.com)\/s\//, message: '必须是阿里云盘、夸克网盘、光鸭云盘或 PikPak 分享链接' },
            { match: /((aliyundrive|alipan)\.com\/s\/[0-9a-zA-Z_]{11,}|pan\.quark\.cn\/s\/[0-9a-zA-Z]+|guangyapan\.com\/s\/[0-9a-zA-Z_-]+|(?:my)?pikpak\.com\/s\/[0-9a-zA-Z_-]+)/, message: '格式错误：xxxxx.com/s/umaDDMR7w4F' }
          ]">
          <a-input v-model.trim='form.sharelink' placeholder='例如：aliyundrive.com/s/umaDDMR7w4F、pan.quark.cn/s/abcd、guangyapan.com/s/abcd 或 mypikpak.com/s/abcd' allow-clear
                   :input-attrs="{ id: 'DaoRuShareInput', autofocus: 'autofocus' }" @paste.stop.prevent='onPaste' />
        </a-form-item>
        <a-form-item field='password' label='提取码：' :rules="[{ minLength: 4, maxLength: 8, message: '提取码必须是4-8个字符' }]">
          <a-input v-model.trim='form.password' placeholder='没有不填' allow-clear style='max-width: 100px' />
        </a-form-item>
      </a-form>
      <br />
    </div>
    <div class='modalfoot'>

      <div style='flex-grow: 1'></div>
      <a-button v-if='!okLoading' type='outline' size='small' @click='handleHide'>取消</a-button>
      <a-button type='primary' size='small' :loading='okLoading' @click='handleOK'>导入</a-button>
    </div>
  </a-modal>
</template>

<style></style>
