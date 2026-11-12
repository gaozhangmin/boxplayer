<script setup lang="ts">
import SourceFormSurface from './SourceFormSurface.vue'
import {t} from './i18n'
import {useNativeLogin} from '../adapters/nativeLogin'
const props=defineProps<{embedded?:boolean;provider?:string;sourceName?:string}>()
const emit=defineEmits<{connected:[];cancel:[]}>()
const {loginVisible,loginProviders,loginProvider,getLoginProviderMeta,activeLoginProviderMeta,loginCur,loginStatus,loginLoading,qrCodeUrl,qrCodeStatusType,qrCodeStatusTips,drive115Tips,drive115Loading,cloud139Authorization,cloud139Loading,cloud189QrStatusType,cloud189Tips,cloud189Loading,guangyaPhone,guangyaCode,guangyaLoading,guangyaSmsState,pikpakUsername,pikpakPassword,pikpakLoading,quarkQrImageUrl,quarkQrStatusType,quarkTips,quarkLoading,dropboxLoading,onedriveLoading,boxLoading,googleLoading,remoteDriveForm,remoteDriveLoading,handleModalOpen,handleClose,handleRefreshQrCodeUrl,handleRefresh115Qr,submitCloud139Login,handleOpen189,sendGuangyaSmsCode,submitGuangyaLogin,handleReopenCloud123,handleReopenBaidu,submitPikPakLogin,handleOpenQuark,handleReopenDropbox,handleReopenOneDrive,handleReopenBox,handleReopenGoogle,submitRemoteDrive}=useNativeLogin(props,emit)
</script>
<template>
  <SourceFormSurface :embedded="embedded" :visible="loginVisible" :title="embedded ? undefined : t('login.driveAccount')" :closable="!embedded" modal-class="userloginmodal" @update:visible="loginVisible = $event" @before-open="handleModalOpen" @close="handleClose">
    <div class="modalbody login-modal-body" :class="{ 'login-embedded': embedded }">
      <aside v-if="!embedded" class="login-provider-sidebar">
        <button
          v-for="provider in loginProviders"
          :key="provider"
          class="login-provider-side-item"
          :class="{ active: loginProvider === provider }"
          :title="getLoginProviderMeta(provider).label"
          @click="loginProvider = provider"
        >
          <span v-if="getLoginProviderMeta(provider).icon" class="login-provider-icon">
            <img :src="getLoginProviderMeta(provider).icon" :alt="getLoginProviderMeta(provider).label" />
          </span>
          <span v-else class="login-provider-fallback">{{ getLoginProviderMeta(provider).label.slice(0, 1) }}</span>
          <span class="login-provider-side-label">{{ getLoginProviderMeta(provider).label }}</span>
        </button>
      </aside>

      <section class="login-provider-content">
        <div class="login-provider-heading" :title="activeLoginProviderMeta.label">
          <span v-if="activeLoginProviderMeta.icon" class="login-provider-heading-icon">
            <img :src="activeLoginProviderMeta.icon" :alt="activeLoginProviderMeta.label" />
          </span>
          <span>{{ activeLoginProviderMeta.label }}</span>
        </div>

        <div v-show="loginProvider === 'aliyun'">
          <a-steps v-model:current="loginCur" :status="loginStatus">
            <a-step :description="t('login.scanOrAccount')">{{ t('login.firstScan') }}</a-step>
            <a-step :description="t('login.mobileAuth')">{{ t('login.secondScan') }}</a-step>
          </a-steps>
          <div id='logindiv'>
            <div class='logincontent'>
            <div id="loginframediv" class="loginframe">
              <a-spin class="loading" :size="32" v-if='loginLoading' :tip="t('common.loading')" />
              
              <div v-if="loginCur===1" class="browser-login-hint"><p>请在阿里云盘登录窗口完成第一次扫码或账号登录，随后在此处进行第二次扫码授权。</p><a-alert v-if="loginStatus==='error'" type="error">{{qrCodeStatusTips}}</a-alert><a-button :loading="loginLoading" @click="handleRefreshQrCodeUrl">重新打开登录窗口</a-button></div>
              <div class="qrcodeframe" v-if="loginCur === 2 && !loginLoading">
                <a-image
                  width='250'
                  height='250'
                  :hide-footer='true'
                  :preview='false'
                  :show-loader="true"
                  @click="handleRefreshQrCodeUrl"
                  style="display:inline-block;"
                  :src="qrCodeUrl">
                </a-image>
                <a-alert banner center :show-icon="false" :type='qrCodeStatusType'>
                  {{ qrCodeStatusTips }}
                </a-alert>
              </div>
            </div>
          </div>
        </div>
        </div>

      <template v-if="loginProvider !== 'aliyun'">
      <div v-if="loginProvider === 'cloud123'">
        <div id='logindiv'>
          <div class='logincontent'>
            <div class="browser-login-hint">
              <p style="margin: 32px 0 8px; font-size: 15px;">{{ t('login.browserOpenedPrefix') }} 123 网盘{{ t('login.authPageSuffix') }}</p>
              <p style="color: var(--color-text-3); font-size: 13px;">{{ t('login.browserContinue') }}</p>
              <a-button style="margin-top: 16px;" @click="handleReopenCloud123">{{ t('login.reopenBrowser') }}</a-button>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="loginProvider === '115'">
        <div id='logindiv'>
          <div class='logincontent'>
            <div id="loginframediv" class="loginframe">
              <a-spin class="loading" :size="32" v-if='loginLoading' :tip="t('common.loading')" />
              <div class="qrcodeframe" v-if="!loginLoading">
                <a-image
                  width='250'
                  height='250'
                  :hide-footer='true'
                  :preview='false'
                  :show-loader="true"
                  @click="handleRefresh115Qr"
                  style="display:inline-block;"
                  :src="qrCodeUrl">
                </a-image>
                <a-alert banner center :show-icon="false" :type="qrCodeStatusType || 'info'">
                  {{ drive115Tips }}
                </a-alert>
              </div>
            </div>
            <div class="cloud123-code">
              
              <a-button type="primary" :loading="drive115Loading" @click="handleRefresh115Qr">{{ t('login.refreshQrCode') }}</a-button>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="loginProvider === '139'">
        <div id='logindiv'>
          <div class='logincontent'>
            <div class="pikpak-login-form">
              <a-textarea v-model="cloud139Authorization" placeholder="粘贴 139 云盘 Authorization（Basic 后面的完整值也可以）" :auto-size="{ minRows: 4, maxRows: 6 }" allow-clear />
              <a-button type="primary" long :loading="cloud139Loading" @click="submitCloud139Login">登录 139 云盘</a-button>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="loginProvider === '189'">
        <div id='logindiv'>
          <div class='logincontent'>
            <div id="loginframediv" class="loginframe">
              <a-spin class="loading" :size="32" v-if='loginLoading' :tip="t('common.loading')" />
              <div class="qrcodeframe" v-if="!loginLoading">
                <div class="cloud189-qrcode-wrap">
                  <img :src="qrCodeUrl" width="250" height="250" alt="登录二维码"/>
                </div>
                <a-alert banner center :show-icon="false" :type="cloud189QrStatusType">
                  {{ cloud189Tips }}
                </a-alert>
              </div>
            </div>
            <div class="quark-login-toolbar" v-if="!loginLoading">
              <a-button type="primary" :loading="cloud189Loading" @click="handleOpen189">{{ t('login.refreshQrCode') }}</a-button>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="loginProvider === 'guangya'">
        <div id='logindiv'>
          <div class='logincontent'>
            <div class="pikpak-login-form">
              <a-input v-model="guangyaPhone" placeholder="手机号，例如 +86 13800138000" allow-clear />
              <a-input v-model="guangyaCode" :placeholder="t('login.smsCode')" allow-clear @press-enter="submitGuangyaLogin" />
              <a-space direction="vertical" fill>
                <a-button type="outline" long :loading="guangyaLoading" @click="sendGuangyaSmsCode">{{ guangyaSmsState ? t('login.resendSmsCode') : t('login.sendSmsCode') }}</a-button>
                <a-button type="primary" long :loading="guangyaLoading" @click="submitGuangyaLogin">登录光鸭云盘</a-button>
              </a-space>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="loginProvider === 'baidu'">
        <div id='logindiv'>
          <div class='logincontent'>
            <div class="browser-login-hint">
              <p style="margin: 32px 0 8px; font-size: 15px;">{{ t('login.browserOpenedPrefix') }}百度网盘{{ t('login.authPageSuffix') }}</p>
              <p style="color: var(--color-text-3); font-size: 13px;">{{ t('login.browserContinue') }}</p>
              <a-button style="margin-top: 16px;" @click="handleReopenBaidu">{{ t('login.reopenBrowser') }}</a-button>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="loginProvider === 'pikpak'">
        <div id='logindiv'>
          <div class='logincontent'>
            <div class="pikpak-login-form">
              <a-input v-model="pikpakUsername" placeholder="PikPak 邮箱 / 手机号 / 用户名" allow-clear />
              <a-input-password v-model="pikpakPassword" placeholder="PikPak 密码" allow-clear @press-enter="submitPikPakLogin" />
              <a-button type="primary" long :loading="pikpakLoading" @click="submitPikPakLogin">登录 PikPak</a-button>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="loginProvider === 'quark'">
        <div id='logindiv'>
          <div class='logincontent quark-logincontent'>
            <a-spin class="loading" :size="32" v-if='loginLoading' :tip="t('common.loading')" />
            <div class="qrcodeframe" v-if="!loginLoading">
              <a-image
                width='250'
                height='250'
                :hide-footer='true'
                :preview='false'
                :show-loader="true"
                @click="handleOpenQuark"
                style="display:inline-block;"
                :src="quarkQrImageUrl">
              </a-image>
              <a-alert banner center :show-icon="false" :type="quarkQrStatusType">
                {{ quarkTips }}
              </a-alert>
            </div>
            <div class="quark-login-toolbar" v-if="!loginLoading">
              <a-button type="primary" :loading="quarkLoading" @click="handleOpenQuark">{{ t('login.refreshQrCode') }}</a-button>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="loginProvider === 'dropbox'">
        <div id='logindiv'>
          <div class='logincontent'>
            <div class="browser-login-hint">
              <p style="margin: 32px 0 8px; font-size: 15px;">{{ t('login.browserOpenedPrefix') }} Dropbox {{ t('login.authPageSuffix') }}</p>
              <p style="color: var(--color-text-3); font-size: 13px;">{{ t('login.browserContinue') }}</p>
              <a-button style="margin-top: 16px;" :loading="dropboxLoading" @click="handleReopenDropbox">{{ t('login.reopenBrowser') }}</a-button>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="loginProvider === 'onedrive'">
        <div id='logindiv'>
          <div class='logincontent'>
            <div class="browser-login-hint">
              <p style="margin: 32px 0 8px; font-size: 15px;">{{ t('login.browserOpenedPrefix') }} OneDrive {{ t('login.authPageSuffix') }}</p>
              <p style="color: var(--color-text-3); font-size: 13px;">{{ t('login.browserContinue') }}</p>
              <a-button style="margin-top: 16px;" :loading="onedriveLoading" @click="handleReopenOneDrive">{{ t('login.reopenBrowser') }}</a-button>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="loginProvider === 'box'">
        <div id='logindiv'>
          <div class='logincontent'>
            <div class="browser-login-hint">
              <p style="margin: 32px 0 8px; font-size: 15px;">{{ t('login.browserOpenedPrefix') }} Box {{ t('login.authPageSuffix') }}</p>
              <p style="color: var(--color-text-3); font-size: 13px;">{{ t('login.browserContinue') }}</p>
              <a-button style="margin-top: 16px;" :loading="boxLoading" @click="handleReopenBox">{{ t('login.reopenBrowser') }}</a-button>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="loginProvider === 'google'">
        <div id='logindiv'><div class='logincontent'><div class="browser-login-hint">
          <p style="margin: 32px 0 8px; font-size: 15px;">{{ t('login.browserOpenedPrefix') }} Google Drive {{ t('login.authPageSuffix') }}</p>
          <p style="color: var(--color-text-3); font-size: 13px;">{{ t('login.browserContinue') }}</p>
          <a-button style="margin-top: 16px;" :loading="googleLoading" @click="handleReopenGoogle">{{ t('login.reopenBrowser') }}</a-button>
        </div></div></div>
      </div>

      <div v-else-if="['smb','nfs','ftp','webdav','alist'].includes(loginProvider)">
        <div id='logindiv'>
          <div class='logincontent'>
            <form class="remote-drive-login-form" :class="{ 'remote-drive-embedded': embedded }" @submit.prevent="submitRemoteDrive">
              <label class="remote-field"><span>{{ t('mediaServer.name') }}</span><a-input v-model="remoteDriveForm.name" :placeholder="t('mediaServer.name')" :disabled="remoteDriveLoading" allow-clear /></label>
              <label class="remote-field"><span>{{ t('mediaServer.address') }}</span><a-input v-model="remoteDriveForm.url" :placeholder="loginProvider === 'alist' ? 'http://127.0.0.1:5244' : ['smb','nfs','ftp'].includes(loginProvider) ? loginProvider + '://nas.local' : 'https://example.com/dav'" :disabled="remoteDriveLoading" allow-clear /></label>
              <label v-if="loginProvider !== 'nfs'" class="remote-field"><span>{{ t('mediaServer.username') }}</span><a-input v-model="remoteDriveForm.username" :disabled="remoteDriveLoading" autocomplete="username" allow-clear /></label>
              <label v-if="loginProvider !== 'nfs'" class="remote-field"><span>{{ t('mediaServer.password') }}</span><a-input-password v-model="remoteDriveForm.password" :disabled="remoteDriveLoading" autocomplete="current-password" allow-clear /></label>
              <label class="remote-field"><span>{{ t('mediaServer.path') }}</span><a-input v-model="remoteDriveForm.rootPath" placeholder="/" :disabled="remoteDriveLoading" allow-clear /></label>
              <label v-if="loginProvider==='nfs'" class="remote-field"><span>Mount 端口</span><a-input v-model="remoteDriveForm.mountPort" placeholder="自动发现" :disabled="remoteDriveLoading" /></label>
              <a-button html-type="submit" type="primary" :loading="remoteDriveLoading">{{ t('mediaServer.connect') }}</a-button>
            </form>
          </div>
        </div>
      </div>
      </template>
      </section>
    </div>
  </SourceFormSurface>
</template>
<style lang="less" scoped>
#logindiv {
  overflow: hidden;
  text-align: center;

  .logincontent {
    position: relative;
    width: 348px;
    height: 367px;
    min-height: 400px;
    margin: 0 auto;
    overflow: hidden;
    text-align: center;

    .loginframe {
      overflow: hidden;
      position: relative;
      width: 100%;
      height: 100%
    }

    .qrcodeframe {
      border-radius: 10px;
      padding: 5px;
      box-shadow: grey 0 0 10px;
      margin: 40px 15px 15px 15px;
    }

    .cloud189-qrcode-wrap {
      display: flex;
      justify-content: center;
    }

    .loading {
      min-height: 60px;
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
    }
  }
}

.userloginmodal .arco-modal-body {
  min-height: 440px;
  padding: 0 16px 16px 16px !important;
}

.login-modal-body {
  display: flex;
  width: 540px;
  height: 458px;
  overflow: hidden;
}

.login-provider-sidebar {
  flex: 0 0 148px;
  height: 100%;
  padding: 8px 8px 8px 0;
  overflow-y: auto;
  overflow-x: hidden;
  border-right: 1px solid var(--color-border-2);
}

.login-provider-sidebar::-webkit-scrollbar {
  width: 6px;
}

.login-provider-sidebar::-webkit-scrollbar-thumb {
  background: var(--color-fill-3);
  border-radius: 999px;
}

.login-provider-side-item {
  width: 100%;
  min-height: 36px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  margin-bottom: 3px;
  color: var(--color-text-2);
  background: transparent;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  transition: background-color 0.15s, color 0.15s;
}

.login-provider-side-item:hover {
  color: var(--color-text-1);
  background: var(--color-fill-2);
}

.login-provider-side-item.active {
  color: rgb(var(--primary-6));
  background: rgba(var(--primary-6), 0.12);
  font-weight: 600;
}

.login-provider-side-label {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 13px;
}

.login-provider-content {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  padding: 8px 0 0 16px;
  overflow: hidden;
}

.login-provider-tab {
  display: inline-flex;
  align-items: center;
  max-width: 92px;
  gap: 5px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  line-height: 1;
}

.login-provider-icon,
.login-provider-heading-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}

.login-provider-icon {
  width: 16px;
  height: 16px;
  overflow: hidden;
}

.login-provider-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  color: rgb(var(--primary-6));
  background: rgba(var(--primary-6), 0.12);
  font-size: 10px;
  font-weight: 700;
}

.login-provider-heading-icon {
  width: 22px;
  height: 22px;
  overflow: hidden;
}

.login-provider-icon img,
.login-provider-heading-icon img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  color: transparent;
  font-size: 0;
}

.login-provider-heading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  margin: 0 0 8px;
  gap: 8px;
  color: var(--color-text-1);
  font-size: 14px;
  font-weight: 600;
}

.cloud123-code {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  margin-top: 12px;
}

.cloud123-code .arco-input-wrapper {
  width: 260px;
}

.browser-login-hint {
  text-align: center;
  padding: 16px 8px 0;
}

.pikpak-login-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 300px;
  margin: 64px auto 0;
}

.remote-drive-login-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 300px;
  margin: 28px auto 0;
  text-align: left;
}

.remote-drive-hint {
  margin: 2px 0 4px;
  color: var(--color-text-3);
  font-size: 12px;
  line-height: 1.55;
}

.quark-logincontent {
  height: 430px !important;
  min-height: 430px !important;
}

.quark-login-toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 0;
}

</style>

<style scoped>
.login-modal-body.login-embedded{width:100%;height:auto;min-height:440px;overflow:visible}
.login-embedded .login-provider-content{padding:0;min-width:0}
.login-embedded .login-provider-heading{display:none}
.login-embedded #logindiv .logincontent{width:100%;max-width:400px;height:auto;min-height:400px}
</style>

<style scoped>
.remote-field{display:grid;grid-template-columns:88px minmax(0,1fr);gap:16px;align-items:center;text-align:right;color:var(--color-text-2);font-size:14px}
.remote-drive-embedded{padding-top:40px!important;width:100%;max-width:400px!important}
.remote-drive-embedded :deep(.arco-input-wrapper){background:transparent;border-radius:4px}
.remote-drive-embedded>.arco-btn{align-self:flex-start;margin-left:104px;min-width:130px}
</style>
