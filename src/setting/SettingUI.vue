<script setup lang='ts'>
import { computed, ref } from 'vue'
import useSettingStore from './settingstore'
import MySwitch from '../layout/MySwitch.vue'
import ServerHttp from '../aliapi/server'
import os from 'os'
import { getAppNewPath, getResourcesPath } from '../utils/electronhelper'
import { existsSync, readFileSync } from 'fs'
import { getPkgVersion } from '../utils/utils'
import { modalUpdateLog } from '../utils/modal'
import fs from 'node:fs'
import message from '../utils/message'
import { Sleep } from '../utils/format'

const platform = window.platform
const settingStore = useSettingStore()
const cb = (val: any) => {
  settingStore.updateStore(val)
}

const getAppVersion = computed(() => {
  const pkgVersion = getPkgVersion()
  if (os.platform() === 'linux') {
    return pkgVersion
  }
  let appVersion = ''
  const localVersion = getResourcesPath('localVersion')
  if (localVersion && existsSync(localVersion)) {
    appVersion = readFileSync(localVersion, 'utf-8')
  } else {
    appVersion = pkgVersion
  }
  return appVersion
})

const verLoading = ref(false)
const handleCheckVer = () => {
  verLoading.value = true
  setTimeout(() => {
    ServerHttp.CheckUpgrade()
    verLoading.value = false
  }, 200)
}
const handleUpdateLog = () => {
  modalUpdateLog()
}

const handleImportAsar = () => {
  window.WebShowOpenDialogSync({
    title: '选择需要导入的Asar文件',
    buttonLabel: '导入更新文件',
    filters: [{ name: 'app.asar', extensions: ['asar'] }],
    properties: ['openFile', 'showHiddenFiles', 'noResolveAliases', 'treatPackageAsDirectory', 'dontAddToRecent']
  }, async (files: string[] | undefined) => {
    if (files && files.length > 0) {
      // 导入到app.new
      await fs.promises.cp(files[0], getAppNewPath())
      message.info('导入更新文件成功，重新打开应用...', 0)
      await Sleep(1000)
      window.WebToElectron({ cmd: 'relaunch' })
    }
  })
}
</script>

<template>
  <div class='settingcard'>
    <div class='settings-app-hero'>
      <div class='settings-app-badge'>Application</div>
      <div class='appver'>BoxPlayer {{ getAppVersion }}</div>
      <div class='settings-app-subtitle'>统一配置桌面外观、启动行为、更新策略与系统集成体验</div>
    </div>
    <div class='settings-app-actions'>
      <a-button type='outline' status='success' size='small' tabindex='-1' @click='handleUpdateLog'>
        更新日志
      </a-button>
      <a-button style='margin-left: 10px' type='outline' size='small' tabindex='-1' :loading='verLoading'
                @click='handleCheckVer'>
        检查更新
      </a-button>
      <a-button style='margin-left: 10px'
                v-if='platform !== "linux"'
                status='warning' type='outline' size='small' tabindex='-1'
                @click='handleImportAsar'>
        手动导入
      </a-button>
    </div>
    <div class='settingspace'></div>
    <div class='settingspace'></div>
    <div class='settinghead'>界面颜色</div>
    <div class='settingrow'>
      <a-radio-group type='button' tabindex='-1' :model-value='settingStore.uiTheme'
                     @update:model-value='cb({ uiTheme: $event })'>
        <a-radio tabindex='-1' value='system'>跟随系统</a-radio>
        <a-radio tabindex='-1' value='light'>浅色模式</a-radio>
        <a-radio tabindex='-1' value='dark'>深色模式</a-radio>
      </a-radio-group>
    </div>
    <div class='settingspace'></div>
    <div class='settinghead'>默认启动 Tab</div>
    <div class='settingrow'>
      <a-radio-group
        type='button'
        tabindex='-1'
        :model-value='settingStore.uiDefaultTab'
        @update:model-value='cb({ uiDefaultTab: $event })'
      >
        <a-radio tabindex='-1' value='pan'>网盘</a-radio>
        <a-radio tabindex='-1' value='media-server'>媒体服务器</a-radio>
        <a-radio tabindex='-1' value='media'>媒体库</a-radio>
      </a-radio-group>
    </div>
    <template v-if="['win32', 'darwin'].includes(platform)">
      <div class='settingspace'></div>
      <div class='settinghead'>开机自启设置</div>
      <div class='settingrow'>
        <MySwitch :value='settingStore.uiLaunchStart' @update:value='cb({ uiLaunchStart: $event })'>
          开机时自动启动
        </MySwitch>
      </div>
      <div class='settingrow' v-if="settingStore.uiLaunchStart">
        <MySwitch :value='settingStore.uiLaunchStartShow'
                  @update:value='cb({ uiLaunchStartShow: $event })'>
          自动启动后显示主窗口
        </MySwitch>
      </div>
    </template>
    <div class='settingspace'></div>
    <div class='settinghead'>检查更新设置</div>
    <div class='settingrow'>
      <MySwitch :value='settingStore.uiLaunchAutoCheckUpdate'
                @update:value='cb({ uiLaunchAutoCheckUpdate: $event })'>
        启动时检查更新
      </MySwitch>
    </div>
    <div class='settingspace'></div>
    <div class='settinghead'>自动签到设置</div>
    <div class='settingrow'>
      <MySwitch :value='settingStore.uiLaunchAutoSign' @update:value='cb({ uiLaunchAutoSign: $event })'>
        启动时自动签到
      </MySwitch>
    </div>
    <div class='settingspace'></div>
    <div class='settinghead'>关闭时彻底退出</div>
    <div class='settingrow'>
      <MySwitch :value='settingStore.uiExitOnClose' @update:value='cb({ uiExitOnClose: $event })'>
        关闭窗口时彻底退出小白羊
      </MySwitch>
      <a-popover position='right'>
        <i class='iconfont iconbulb' />
        <template #content>
          <div>
            默认：<span class='opred'>关闭</span>
            <hr />
            默认是点击窗口上的关闭按钮时<br />最小化到托盘，继续上传/下载<br /><br />开启此设置后直接彻底退出小白羊程序
          </div>
        </template>
      </a-popover>
    </div>
    <div class='settingspace'></div>
    <div class='settinghead'>软件更新代理</div>
    <div class='settingrow'>
      <MySwitch :value='settingStore.uiUpdateProxyEnable' @update:value='cb({ uiUpdateProxyEnable: $event })'>
        开启软件更新代理
      </MySwitch>
      <div class='settingrow' v-if="settingStore.uiUpdateProxyEnable">
        <a-input v-model.trim='settingStore.uiUpdateProxyUrl'
                 allow-clear
                 :style="{ width: '280px' }"
                 placeholder='软件更新代理'
                 @update:model-value='cb({ uiUpdateProxyUrl: $event })' />
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-app-hero {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
}

.settings-app-badge {
  display: inline-flex;
  align-self: flex-start;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(88, 130, 255, 0.12);
  color: var(--color-primary-6);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.appver {
  font-weight: 600;
  font-size: 28px;
  line-height: 1.4;
}

.settings-app-subtitle {
  max-width: 520px;
  color: var(--color-text-2);
  font-size: 14px;
  line-height: 1.7;
}

.settings-app-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.settings-app-actions :deep(.arco-btn) {
  margin-left: 0 !important;
}

:global(html.dark) .settings-app-badge {
  background: rgba(120, 160, 255, 0.2);
  color: #dbe6ff;
}

@media (max-width: 900px) {
  .appver {
    font-size: 24px;
  }
}
</style>
