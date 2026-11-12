<script setup lang="ts">
import {Modal as AModal,Input as AInput,InputPassword as AInputPassword,Form as AForm,FormItem as AFormItem,Button as AButton} from '@arco-design/web-vue'
import {computed} from 'vue'
import NativeServerRegistry from './NativeServerRegistry.vue'
import {readPreferences} from '@/features/servers/preferences'
import ServerEndpoints from '@/features/servers/ServerEndpoints.vue'
import type {FilesPorts} from './filesPorts'
const props=defineProps<{ports:FilesPorts}>()
const editingServer=computed(()=>{const account=props.ports.dialogAccount.value,target=props.ports.dialog.value;return account&&target&&['jellyfin','emby','plex'].includes(account.providerId)?{id:account.id,name:target.name,type:account.providerId as 'jellyfin'|'emby'|'plex',baseUrl:account.baseUrl,username:target.username,libraryMode:readPreferences(account.id).libraryMode,createdAt:0,updatedAt:0}:undefined})
const sourceDialog=computed(()=>props.ports.dialog.value),account=computed(()=>props.ports.dialogAccount.value)
</script>
<template>
 <ServerEndpoints v-if="sourceDialog?.action==='endpoint'&&account" :account="account" @close="ports.dialog.value=undefined"/>
 <a-modal v-else-if="sourceDialog?.action==='editShare'&&editingServer" :visible="true" :footer="false" :closable="false" @cancel="ports.dialog.value=undefined"><NativeServerRegistry embedded :editing-server="editingServer" @close="ports.dialog.value=undefined" @saved="ports.dialog.value=undefined;ports.refresh()"/></a-modal>
 <a-modal v-else :visible="!!sourceDialog" :title="sourceDialog?.action==='editShare'?'编辑共享':sourceDialog?.action==='renameCollection'?'重命名收藏夹':sourceDialog?.action==='cover'?'选择封面':'添加到收藏夹'" :footer="sourceDialog?.action==='editShare'?false:undefined" :confirm-loading="ports.busy.value" @cancel="ports.dialog.value=undefined" @ok="ports.saveDialog">
  <a-form v-if="sourceDialog?.action==='editShare'" :model="sourceDialog" layout="vertical" @submit-success="ports.saveDialog">
   <a-form-item label="名称"><a-input v-model="sourceDialog.name"/></a-form-item>
   <template v-if="['webdav','smb','nfs','ftp'].includes(account?.providerId||'')"><a-form-item label="地址"><a-input v-model="sourceDialog.url"/></a-form-item><a-form-item v-if="account?.providerId!=='nfs'" label="用户名"><a-input v-model="sourceDialog.username"/></a-form-item><a-form-item v-if="account?.providerId!=='nfs'" label="密码"><a-input-password v-model="sourceDialog.password" placeholder="保留已保存的密码"/></a-form-item><a-form-item label="挂载路径"><a-input v-model="sourceDialog.rootPath"/></a-form-item></template>
   <a-button html-type="submit" type="primary" :loading="ports.busy.value">保存</a-button>
  </a-form>
  <a-input v-else-if="sourceDialog" v-model="sourceDialog.name" @press-enter="ports.saveDialog"/>
  <p v-if="ports.error.value" role="alert">{{ports.error.value}}</p>
 </a-modal>
</template>
