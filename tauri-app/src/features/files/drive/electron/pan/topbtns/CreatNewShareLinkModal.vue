<script setup lang='ts'>
import type {IAliGetFileModel} from '../../aliapi/alimodels'
import {modalCloseAll} from '@/features/files/drive/creationPorts'
import {computed,PropType,reactive,ref,onUnmounted} from 'vue'
import dayjs from 'dayjs'
import {usePanTreeStore,useSettingStore,isCloud123User,message} from '@/features/files/drive/ports'
import {humanDateTime,randomSharePassword} from '../../utils/format'
import {copyToClipboard} from '@/features/files/drive/batchRenamePorts'
import IconFont from '@/features/files/electron/IconFont.vue'
import {GetShareUrlFormate} from '../../utils/shareurl'
import {createDriveShare} from '@/features/files/drive/sharePorts'
const formRef = ref()
const okLoading = ref(false)
const okBatchLoading = ref(false)
const settingStore = useSettingStore()
const shareType = ref({type:'s',title:'分享'})

const form = reactive({
  expiration: '',
  share_pwd: '',
  share_name: '',
  mutil: false,
  paid: false,
  payAmount: 1,
  resourceDesc: '',
  isReward: false
})
const props = defineProps({
  visible: {
    type: Boolean,
    required: true
  },
  sharetype: {
    type: String,
    required: true
  },
  driveType: {
    type: String,
    required: true
  },
  filelist: {
    type: Array as PropType<IAliGetFileModel[]>,
    required: true
  }
})
const getShareType = (): any => {
  const key = props.driveType
  return key.includes('backup') ? { type: 't', title: '快传' } : { type: 's', title: '分享' }
}
const isCloud123 = computed(() => props.driveType === 'cloud123' || isCloud123User(usePanTreeStore().user_id))

const handleOpen = async () => {
  form.share_name = props.filelist[0]?.name||''
  shareType.value = getShareType()
  let share_pwd = ''
  if (settingStore.uiSharePassword == 'random') share_pwd = randomSharePassword()
  else if (settingStore.uiSharePassword == 'last') share_pwd = localStorage.getItem('share_pwd') || ''
  form.share_pwd = share_pwd
  form.paid = false
  form.payAmount = 1
  form.resourceDesc = ''
  form.isReward = false

  let expiration = Date.now()
  if (settingStore.uiShareDays == 'always') expiration = 0
  else if (settingStore.uiShareDays == 'week') expiration += 7 * 24 * 60 * 60 * 1000
  else expiration += 30 * 24 * 60 * 60 * 1000

  form.expiration = expiration > 0 ? humanDateTime(expiration) : ''
}

const handleClose = () => {
  if (okLoading.value) okLoading.value = false
  if (okBatchLoading.value) okBatchLoading.value = false
  formRef.value?.resetFields()
}

const handleHide = () => {
  modalCloseAll()
}
const sharing=createDriveShare(props.filelist)
onUnmounted(()=>sharing.dispose())
const completed=ref<string[]>([])
const handleOK = async (multi:boolean) => {
 if(okLoading.value||okBatchLoading.value)return
 try{
  sharing.check()
  if(!props.filelist.length)throw Error('没有可以分享的文件')
  const mindate = new Date()
  mindate.setMinutes(mindate.getMinutes() + 2)
  let expiration = shareType.value.type==='s'&&!form.paid?form.expiration:''
  if (expiration) expiration = new Date(expiration) < mindate ? mindate.toISOString() : new Date(expiration).toISOString()
  else expiration = ''
  let share_name = form.share_name.trim().replaceAll('"', '')
  share_name = share_name.replace(/[<>:"\\|?*]+/g, '')
  share_name = share_name.replace(/[\f\n\r\t\v]/g, '')
  while (share_name.endsWith(' ') || share_name.endsWith('.')) share_name = share_name.substring(0, share_name.length - 1)
  if (shareType.value.type === 's' && share_name.length < 1) {
    message.error('分享链接标题不能为空')
    return
  }
  const share_pwd = shareType.value.type==='s'&&!form.paid?form.share_pwd:''

  if(share_pwd&&!/^[a-zA-Z0-9]{4}$/.test(share_pwd))throw Error('提取码必须是4个字母或数字')
  if(expiration&&!Number.isFinite(Date.parse(expiration)))throw Error('有效期无效')
  if(multi)okBatchLoading.value=true
  else okLoading.value=true
  const paid=form.paid?{amount:Number(form.payAmount),description:form.resourceDesc,reward:form.isReward}:undefined
  const signature=JSON.stringify([multi,share_name,paid?null:form.expiration,share_pwd,paid])
  if(created.size&&submitted!==signature)throw Error('已有分享成功；请保留原选项重试，或关闭后重新创建')
  const groups=multi?props.filelist.map(file=>[file.file_id]):[props.filelist.map(file=>file.file_id)]
  const failures:string[]=[]
  // Retain confirmed links after partial failure so retry never republishes them.
  for(const ids of groups){
   const key=JSON.stringify(ids)
   if(created.has(key))continue
   sharing.check()
   try{
    const result=await sharing.create(ids,share_name,expiration,share_pwd,shareType.value.type==='t',paid)
    const formatted=(shareType.value.type==='t'?'【快传链接】':'')+GetShareUrlFormate(share_name,result.url,result.password||'')
    submitted=signature;created.set(key,formatted);completed.value=[...created.values()]
   }catch(error){sharing.check();failures.push(error instanceof Error?error.message:String(error))}
  }
  if(completed.value.length){await copyToClipboard(completed.value.join('\n'));sharing.check()}
  if(failures.length){message.error('部分分享未完成：'+failures.join('；'));return}
  message.success('创建 '+completed.value.length+' 条'+(paid?'付费分享':shareType.value.title)+'链接成功，分享链接已复制到剪切板')
  modalCloseAll()
 }catch(error){try{sharing.check();message.error(error instanceof Error?error.message:String(error))}catch{}}
 finally{okLoading.value=false;okBatchLoading.value=false}
}
const created=new Map<string,string>()
let submitted=''
</script>

<template>
  <a-modal :visible='visible' modal-class='modalclass createsharelinkmodal source-drive-dialog' :footer='false'
           :unmount-on-close='true' :mask-closable='false'
           @cancel='handleHide' @before-open='handleOpen' @close='handleClose'>
    <template #title>
      <span class='modaltitle'>
        创建{{ shareType.title }}链接
        <a-popover position="bottom">
          <IconFont name="iconbulb" />
          <template #content>
            <div v-if="shareType.type === 's'">
              <span class="opred">普通用户</span>每天只能使用分享功能<span class="opred">5次</span><br />
              <span class="opred">会员用户和Lv.1及以上的达人用户</span>，每天可使用分享次数<span class="opred">1000次</span><br />
              <div class="hrspace"></div>
              <span class="oporg">超过上限后，将提示「今日分享次数已达上限」。</span>
              <div class="hrspace"></div>
              <span class="oporg">目前支持分享的文件类型有 image、video、doc、other</span> <br />
              1、image支持以下格式：JPG、JPEG、PNG、HEIC、GIF、<br />
              WEBP、 BMP <br />
              2、video 支持以下格式：ASF、AVI、FLASH、FLV、LIVP、M3U8、<br />
              MOV、MP4、MPG、RM、RMVB、TS、WMA、WMV、MKV <br />
              3、doc 支持以下格式：WORD、EXCEL、OUTLOOK、PDF、PPT、RTF、<br />
              TXT、VISIO<br />
              4、other支持以下格式：MODE、FONT、APPLICATION <br />
              <div class="hrspace"></div>
              文件夹已支持分享，<span class="oporg">压缩包暂不支持（可以洗码分享）</span>
            </div>
            <div v-else>
              <span class="opred">普通用户</span>每天的快传次数为<span class="opred">5次</span><br />
              <span class="opred">会员用户</span>每天的快传次数为<span class="opred">100次</span><br />
              <div class="hrspace"></div>
              普通用户请前往会员中心，购买会员开通权益<br />
            </div>
          </template>
        </a-popover>
        <span class='titletips'> (已选择{{ filelist.length }}个文件) </span>
      </span>
    </template>
    <div class='modalbody' style='width: 440px'>
      <a-form ref='formRef' :model='form' layout='vertical'>
        <a-form-item field='share_name'>
          <template #label>
            <template v-if='shareType.type === "s"'> {{ shareType.title }}链接标题：</template>
            <template v-else> {{ shareType.title }}文件：</template>
            <span class='opblue' style='margin-left: 0; font-size: 12px' v-if='shareType.type === "s"'> 修改后的标题只有自己可见 </span>
            <span class='opblue' style='margin-left: 0; font-size: 12px' v-else> 🎉快传支持发送所有格式的文件 </span>
          </template>
          <a-input v-model.trim='form.share_name' :placeholder='form.share_name' />
        </a-form-item>

        <template v-if='shareType.type === "s"'>
          <a-alert v-if="isCloud123" type="info" style="margin-bottom: 12px">
            <a-checkbox v-model="form.paid">创建123云盘付费分享</a-checkbox>
          </a-alert>
          <template v-if="form.paid && isCloud123">
            <a-form-item field="payAmount" label="购买金额（元）">
              <a-input-number v-model="form.payAmount" :min="1" :max="1000" :precision="0" />
            </a-form-item>
            <a-form-item field="resourceDesc" label="资源说明（可选）">
              <a-textarea v-model="form.resourceDesc" :max-length="200" />
            </a-form-item>
            <a-checkbox v-model="form.isReward">允许用户打赏</a-checkbox>
          </template>
          <a-row>
            <a-col flex='200px'> 有效期：</a-col>
            <a-col flex='12px'></a-col>
            <a-col flex='100px'> 提取码：</a-col>
            <a-col flex='auto'></a-col>
          </a-row>
          <a-row>
            <a-col flex='200px'>
              <a-form-item field='expiration'>
                <a-date-picker
                  v-model='form.expiration'
                  style='width: 200px; margin: 0'
                  show-time
                  placeholder='永久有效'
                  value-format='YYYY-MM-DD HH:mm:ss'
                  :shortcuts="[
                    { label: '永久', value: () => '' },
                    { label: '3小时', value: () => dayjs().add(3, 'hour') },
                    { label: '1天', value: () => dayjs().add(1, 'day') },
                    { label: '3天', value: () => dayjs().add(3, 'day') },
                    { label: '7天', value: () => dayjs().add(7, 'day') },
                    { label: '30天', value: () => dayjs().add(30, 'day') }
                  ]" />
              </a-form-item>
            </a-col>
            <a-col flex='12px'></a-col>
            <a-col flex='120px'>
              <a-form-item field='share_pwd' :rules="[{ length: 4, message: '提取码必须是4个字符' }]">
                <a-input v-model='form.share_pwd' tabindex='-1' placeholder='没有不填' />
              </a-form-item>
            </a-col>
            <a-col flex='auto'></a-col>
          </a-row>
        </template>
      </a-form>
    </div>
    <div class='modalfoot'>
      <a-button type='outline' size='small' :loading='okBatchLoading' @click='handleOK(true)'>
        为每个文件单独创建
      </a-button>
      <div style='flex-grow: 1'></div>
      <a-button v-if='!okLoading' type='outline' size='small' @click='handleHide'>取消</a-button>
      <a-button type='primary' size='small' :loading='okLoading' @click='handleOK(false)'>
        创建{{ shareType.title }}链接
      </a-button>
    </div>
  </a-modal>
</template>

<style scoped>
.iconbulb {
  display: inline-block;
  height: 22px;
  margin-left: 4px;
  color: #ffc107dd;
  font-size: 18px;
  line-height: 22px;
  cursor: help;
}
</style>
