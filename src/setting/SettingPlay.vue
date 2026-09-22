<script setup lang='ts'>
import useSettingStore from './settingstore'
import MySwitch from '../layout/MySwitch.vue'
import { computed, onMounted, ref } from 'vue'
import cache from '../utils/cache'
import message from '../utils/message'
import { t } from '../i18n'

const settingStore = useSettingStore()
const cb = (val: any) => {
  settingStore.updateStore(val)
}

const platform = window.platform
const supportsEmbeddedMpv = platform === 'darwin' || platform === 'win32' || platform === 'linux'

function handleSelectPlayer() {
  if (window.WebShowOpenDialogSync) {
    window.WebShowOpenDialogSync(
      {
        title: t('settings.play.selectExecutable'),
        buttonLabel: t('common.select'),
        properties: ['openFile'],
        defaultPath: settingStore.uiVideoPlayerPath,
        filters: [{ name: t('settings.play.application'), extensions: ['exe', 'app'] }]
      },
      (result: string[] | undefined) => {
        if (result && result[0]) {
          settingStore.updateStore({ uiVideoPlayerPath: result[0] })
        }
      }
    )
  }
}

const playerType = computed(() => {
  const path = settingStore.uiVideoPlayer === 'mpv' ? 'mpv' : settingStore.uiVideoPlayerPath
  return path.toLowerCase()
})

const embeddedMpvCapability = ref<any>()
const sharedTextureCapability = ref<{ available: boolean; platform: string; reason?: string }>()
const isMpvPlayer = computed(() => settingStore.uiVideoPlayer === 'mpv')
const mpvStatusText = computed(() => {
  if (!isMpvPlayer.value) return ''
  if (embeddedMpvCapability.value?.enabled) return '内置 MPV 已启用。'
  const reason = embeddedMpvCapability.value?.reason || '当前平台的内置 MPV 尚未启用。'
  const textureReason = sharedTextureCapability.value && !sharedTextureCapability.value.available ? sharedTextureCapability.value.reason : ''
  return [reason, textureReason].filter(Boolean).join('；')
})

async function refreshMpvEmbeddedStatus() {
  if (!supportsEmbeddedMpv) return
  const capability = await window.WebMpvEmbeddedCapability?.()
  if (capability) embeddedMpvCapability.value = capability
  if (window.WebMpvSharedTextureCapability) sharedTextureCapability.value = window.WebMpvSharedTextureCapability()
}

async function handleUseMpv() {
  if (!supportsEmbeddedMpv) {
    settingStore.updateStore({ uiVideoPlayer: 'other' })
    message.warning('当前平台尚不支持内置 MPV。')
    return
  }
  settingStore.updateStore({ uiVideoPlayer: 'mpv' })
  await refreshMpvEmbeddedStatus()
  if (embeddedMpvCapability.value?.enabled) {
    message.success('已设置为内置 MPV 播放器。')
  } else {
    message.warning(mpvStatusText.value || '当前平台的内置 MPV 尚未启用。')
  }
}

const handleClearOutDateDanmuCache = () => {
  cache.clearOutDate()
  message.success(t('settings.play.danmakuCacheCleared'))
}
const handleClearDanmuCache = () => {
  cache.clearSelf()
  message.success(t('settings.play.danmakuCacheCleared'))
}

onMounted(() => {
  if (!supportsEmbeddedMpv && settingStore.uiVideoPlayer === 'mpv') {
    settingStore.updateStore({ uiVideoPlayer: 'other' })
  }
  refreshMpvEmbeddedStatus()
})

</script>

<template>
  <div class='settingcard play-settings-card'>
    <div class='play-settings-intro'>
      <div class='play-settings-kicker'>Playback</div>
      <div class='play-settings-copy'>{{ t('settings.play.intro') }}</div>
    </div>

    <div class='play-setting-group'>
      <div class='play-setting-header'>
        <div class='settinghead'>{{ t('settings.play.choosePlayer') }}</div>
      </div>
      <div class='settingrow play-setting-row play-setting-row--stack'>
      <a-radio-group type='button' tabindex='-1' :model-value='settingStore.uiVideoPlayer'
                     @update:model-value='cb({ uiVideoPlayer: $event })'>
        <a-radio tabindex='-1' value='web'>{{ t('settings.play.webPlayer') }}</a-radio>
        <a-radio v-if='supportsEmbeddedMpv' tabindex='-1' value='mpv'>{{ t('settings.play.mpvPlayer') }}</a-radio>
        <a-radio tabindex='-1' value='other'>{{ t('settings.play.customPlayer') }}</a-radio>
      </a-radio-group>
      <a-popover position='bottom'>
        <IconFont name="iconbulb" />
        <template #content>
          <div class='play-col-wide'>
            默认：<span class='opred'>内置网页播放器</span>
            <hr />
            <span class='opred'>内置网页播放器</span>：<br />
            使用ArtPlayer网页，在线播放视频<br />
            支持 选择清晰度、倍速播放、字幕选择、画中画模式，播放加密视频
            <div class='hrspace'></div>
            <span class='opred'>内置 MPV 播放器</span>：<br />
            macOS 使用共享纹理；Windows / Linux 使用软件画面通道。仅在对应资源包可用时启用。
            <div class='hrspace'></div>
            <span class='opred'>自定义播放软件</span>：<br />
            是实验性的功能，可以<span class='oporg'>自己选择</span>电脑上安装的播放软件<br />
            例如:PotPlayer,MPV,Infuse,IINA等等<br />
          </div>
        </template>
      </a-popover>
      <div v-show="settingStore.uiVideoPlayer === 'web'" class='hitText'>
        {{ t('settings.play.webPlayerHint') }}
      </div>
      <div v-show="supportsEmbeddedMpv && settingStore.uiVideoPlayer === 'mpv'" class='hitText mpv-status'>
        <div>{{ mpvStatusText }}</div>
        <a-button size='mini' tabindex='-1' type='outline' @click='handleUseMpv'>{{ t('settings.play.recheckMpv') }}</a-button>
      </div>
      </div>
    </div>

    <div class='play-setting-group'>
      <div class='play-setting-header'>
        <div class='settinghead'>{{ t('settings.play.defaultQuality') }}</div>
        <a-popover position='bottom'>
          <IconFont name="iconbulb" />
          <template #content>
            <div>
              默认：<span class='opred'>播放原始的文件</span>
              <hr />
              <span class='opred'>播放原始的文件</span>：<br />
              原始的清晰度(1080P,2K,4K)，支持<span class='oporg'>多个音轨</span>/
              <span class='oporg'>多个字幕</span>的切换<br />
              可以拖放加载自己的字幕,但文件体积太大时会卡(网络卡)
              <div class='hrspace'></div>
              <span class='opred'>播放转码后视频</span>：<br />
              支持2560p/1080P/540P/720P清晰度选择，不能选择音轨/字幕<br />
              理论上播放更流畅，但可能遇到字幕不显示（内置字幕默认使用中文）
              <div class='hrspace'></div>
              <span class='oporg'>注：违规视频会<span class='opblue'>自动</span>通过转码视频播放</span>
            </div>
          </template>
        </a-popover>
      </div>
      <div class='settingrow play-setting-row'>
      <a-select :model-value='settingStore.uiVideoQuality' tabindex='-1'
                @update:model-value='cb({ uiVideoQuality: $event })'
                :style="{width:'252px'}" :placeholder="t('settings.play.qualitySelect')"
                :trigger-props="{ autoFitPopupMinWidth: true }">
        <a-option value="Origin">{{ t('settings.play.qualityOrigin') }}</a-option>
        <a-option value="QHD">{{ t('settings.play.qualityQhd') }}</a-option>
        <a-option value="FHD">{{ t('settings.play.qualityFhd') }}</a-option>
        <a-option value="HD">{{ t('settings.play.qualityHd') }}</a-option>
        <a-option value="SD">{{ t('settings.play.qualitySd') }}</a-option>
        <a-option value="LD">{{ t('settings.play.qualityLd') }}</a-option>
      </a-select>
      </div>
    </div>

    <div class='play-setting-group'>
      <div class='play-setting-header'>
        <div class='settinghead'>{{ t('settings.play.mediaSubtitleScope') }}</div>
      </div>
      <div class='settingrow play-setting-row play-setting-row--stack'>
        <a-radio-group type='button' tabindex='-1' :model-value='settingStore.mediaLibrarySubtitleScope'
                       @update:model-value='cb({ mediaLibrarySubtitleScope: $event })'>
          <a-radio tabindex='-1' value='same-folder'>{{ t('settings.play.subtitleSameFolder') }}</a-radio>
          <a-radio tabindex='-1' value='include-subfolders'>{{ t('settings.play.subtitleIncludeSubfolders') }}</a-radio>
        </a-radio-group>
        <div class='hitText'>{{ t('settings.play.mediaSubtitleScopeHint') }}</div>
      </div>
    </div>

    <template v-if="settingStore.uiVideoPlayer === 'web'">
      <div class='play-setting-group'>
        <div class='play-setting-header'>
          <div class='settinghead'>{{ t('settings.play.danmakuCache') }}</div>
        </div>
        <div class="settingrow play-setting-row">
        <a-button type="outline" size="small" tabindex="-1" status="success" style="margin-right: 16px"
                  @click='handleClearOutDateDanmuCache'>
          {{ t('settings.play.clearExpired') }}
        </a-button>
        <a-popconfirm :content="t('settings.debug.confirmClearCache')" @ok="handleClearDanmuCache">
          <a-button type="outline" size="small" tabindex="-1" status="danger" style="margin-right: 16px">
            {{ t('settings.play.clearAll') }}
          </a-button>
        </a-popconfirm>
        </div>
      </div>
    </template>
    <template v-if="settingStore.uiVideoPlayer !== 'web'">
      <div class='play-setting-group'>
        <div class='play-setting-header'>
          <div class='settinghead'>{{ t('settings.play.promptQuality') }}</div>
        </div>
        <div class='settingrow play-setting-row'>
        <MySwitch :value='settingStore.uiVideoQualityTips'
                  @update:value='cb({ uiVideoQualityTips: $event })'>
          {{ t('settings.play.promptQualitySwitch') }}
        </MySwitch>
        </div>
      </div>

      <div class='play-setting-group'>
        <div class='play-setting-header'>
          <div class='settinghead'>{{ t('settings.play.rememberQuality') }}</div>
        </div>
        <div class='settingrow play-setting-row'>
        <MySwitch :value='settingStore.uiVideoQualityLastSelect'
                  @update:value='cb({ uiVideoQualityLastSelect: $event })'>
          {{ t('settings.play.rememberQualitySwitch') }}
        </MySwitch>
        </div>
      </div>

      <template v-if="!settingStore.uiVideoEnablePlayerList || (settingStore.uiVideoEnablePlayerList && !playerType.includes('potplayer'))">
        <div class='play-setting-group'>
          <div class='play-setting-header'>
            <div class='settinghead'>{{ t('settings.play.subtitleLoading') }}</div>
            <a-popover position='bottom'>
              <IconFont name="iconbulb" />
              <template #content>
                <div class='play-col-wide'>
                  默认：<span class='opred'>自动加载同名字幕</span>
                  <hr />
                  <span class='opred'>关闭字幕加载</span>：<br />
                  不自动加载字幕
                  <div class='hrspace'></div>
                  <span class='opred'>自动加载同名字幕</span>：<br />
                  当只有一个字幕文件时，无法比较字幕是否和视频名称同名<br />默认会加载该字幕
                  <div class='hrspace'></div>
                </div>
              </template>
            </a-popover>
          </div>
          <div class='settingrow play-setting-row'>
          <a-radio-group type='button' tabindex='-1' :model-value='settingStore.uiVideoSubtitleMode'
                         @update:model-value='cb({ uiVideoSubtitleMode: $event })'>
            <a-radio tabindex='-1' value='close'>{{ t('settings.play.subtitleClose') }}</a-radio>
            <a-radio tabindex='-1' value='auto'>{{ t('settings.play.subtitleAuto') }}</a-radio>
            <a-radio tabindex='-1' value='select'>{{ t('settings.play.subtitleManual') }}</a-radio>
          </a-radio-group>
          </div>
        </div>
      </template>

      <template v-if='playerType.includes("mpv") || playerType.includes("potplayer")'>
        <div class='play-setting-group'>
          <div class='play-setting-header'>
            <div class='settinghead'>{{ t('settings.play.playlistSettings') }}</div>
            <a-popover position='bottom'>
              <IconFont name="iconbulb" />
              <template #content>
                <div class='play-col-md'>
                  <span class='opred'>PotPlayer开启播放列表：</span><br>
                  无法自动加载字幕和跳转播放历史 <br>
                  <hr />
                </div>
              </template>
            </a-popover>
          </div>
          <div class='settingrow play-setting-row'>
          <MySwitch :value='settingStore.uiVideoEnablePlayerList'
                    @update:value='cb({ uiVideoEnablePlayerList: $event })'>
            {{ t('settings.play.enablePlaylist') }}
          </MySwitch>
          </div>
        </div>
      </template>

      <template v-if='settingStore.uiVideoEnablePlayerList && !playerType.includes("mpv")'>
        <div class='play-setting-group'>
          <div class='play-setting-header'>
            <div class='settinghead'>{{ t('settings.play.playerExitSettings') }}</div>
          </div>
          <div class='settingrow play-setting-row'>
          <MySwitch :value='settingStore.uiVideoPlayerExit' @update:value='cb({ uiVideoPlayerExit: $event })'>
            {{ t('settings.play.exitWithApp') }}
          </MySwitch>
          </div>
        </div>
      </template>

      <template v-if='(settingStore.uiVideoEnablePlayerList || settingStore.uiVideoPlayerHistory)
                      && playerType.includes("mpv")'>
        <div class='play-setting-group'>
          <div class='play-setting-header'>
            <div class='settinghead'>{{ t('settings.play.playerExitSettings') }}</div>
          </div>
          <div class='settingrow play-setting-row'>
          <MySwitch :value='settingStore.uiVideoPlayerExit' @update:value='cb({ uiVideoPlayerExit: $event })'>
            {{ t('settings.play.autoExitAfterPlayback') }}
          </MySwitch>
          </div>
        </div>
      </template>

      <div class='play-setting-group'>
        <div class='play-setting-header'>
            <div class='settinghead'>{{ t('settings.play.historySettings') }}</div>
          <a-popover position='bottom'>
            <IconFont name="iconbulb" />
            <template #content>
              <div class='play-col-wide'>
                <span class='opblue'>仅Mpv支持同步 播放进度</span> <br>
                其他播放器只能够跳转到网页播放器历史进度
                <hr />
                已支持：PotPlayer，Mpv
              </div>
            </template>
          </a-popover>
        </div>
        <div class='settingrow play-setting-row'>
        <MySwitch :value='settingStore.uiVideoPlayerHistory' @update:value='cb({ uiVideoPlayerHistory: $event })'>
          {{ t('settings.play.rememberHistory') }}
        </MySwitch>
        </div>
      </div>

      <div class='play-setting-group'>
        <div class='play-setting-header'>
            <div class='settinghead'>{{ t('settings.play.launchParams') }}</div>
          <a-popover position='bottom'>
            <IconFont name="iconbulb" />
            <template #content>
              <div class='play-col-wide'>
                <span class='opred'>自定义播放器参数, 使用,【逗号】分割</span> <br>
                <span class='opred'>参数错误可能无法启动</span> <br>
                <hr />
                <span class='opblue'>例如【MPV播放器HDR】：</span> --d3d11-output-csp=pq
              </div>
            </template>
          </a-popover>
        </div>
        <div class='settingrow play-setting-row'>
        <a-textarea
          v-model.trim='settingStore.uiVideoPlayerParams'
          :style="{ width: '420px', maxWidth: '100%' }"
          :autoSize='{minRows: 1, maxRows: 2}'
          allow-clear
          @keydown='(e:any) => e.stopPropagation()'
          :placeholder="t('settings.play.launchParamsPlaceholder')"
          @update:model-value='cb({ uiVideoPlayerParams: $event })' />
        </div>
      </div>

      <div v-if='settingStore.uiVideoPlayer === "other"' class='play-setting-group'>
        <div class='play-setting-header'>
          <div class='settinghead'>{{ t('settings.play.customPlayerPath') }}</div>
          <a-popover position='bottom'>
            <IconFont name="iconbulb" />
            <template #content>
              <div class='play-col-wide'>
                <span class='opred'>windows</span>：选择一个播放软件.exe
                <hr />
                直接手动选择播放软件的exe文件即可<br />
                例如：选择<span class='opblue'>C:\Program Files\Potplayer\Potplayer.exe</span><br />
                也可以直接选择桌面上播放软件的快捷方式
                <div class='hrspace'></div>
                已测试：Potplayer，VLC，KMPlayer，恒星播放器，SMPlayer，MPC-HC
                <div class='hrspace'></div>
                详情请参阅<span class='opblue'>帮助文档</span>
              </div>
            </template>
          </a-popover>
        </div>
        <template v-if='settingStore.uiVideoPlayer=== "other"'>
          <div v-show="playerType.includes('mpv')" class='hitText'>
            {{ t('settings.play.mpvSupportHint') }}
          </div>
          <div v-show="playerType.includes('potplayer')" class='hitText'>
            {{ t('settings.play.potplayerSupportHint') }}
          </div>
        </template>
        <div class='settingrow play-setting-row'
             :style="{ display: settingStore.uiVideoPlayer === 'other' && platform === 'win32' ? '' : 'none' }">
          <a-input-search tabindex='-1' class='play-player-path' :readonly='true' :button-text="t('settings.play.selectPlayerApp')" search-button
                          :model-value='settingStore.uiVideoPlayerPath' @search='handleSelectPlayer' />
        </div>
        <div class='settingrow play-setting-row' :style="{ display: settingStore.uiVideoPlayer === 'other' && platform === 'darwin' ? '' : 'none' }">
          <a-input-search tabindex='-1' class='play-player-path' :readonly='true' :button-text="t('settings.play.selectPlayerApp')" search-button
                          :model-value='settingStore.uiVideoPlayerPath' @search='handleSelectPlayer' />
          <a-popover position='bottom'>
            <IconFont name="iconbulb" />
            <template #content>
              <div class='play-col-wide'>
                <span class='opred'>macOS</span>：选择一个播放软件.app
                <hr />
                1.点击 选择播放软件按钮 <span class='opblue'>--></span> 弹出文件选择框，<br />
                2.点击 左上 应用程序 <span class='opblue'>--></span> 点击一个 播放软件 <span class='opblue'>--></span> 点击
                确定
                <div class='hrspace'></div>
                已测试：Mpv，Vlc，IINA，MKPlayer
                <div class='hrspace'></div>
                详情请参阅<span class='opblue'>帮助文档</span>
              </div>
            </template>
          </a-popover>
        </div>
        <div class='settingrow play-setting-row'
             :style="{ display: settingStore.uiVideoPlayer === 'other' && platform == 'linux' ? '' : 'none' }">
          <a-auto-complete :data="['mpv', 'vlc', 'totem', 'mplayer', 'smplayer', 'xine', 'parole', 'kodi']"
                           :style="{ width: '420px', maxWidth: '100%' }" :placeholder="t('settings.play.enterPlayerCommand')" strict
                           :model-value='settingStore.uiVideoPlayerPath' @change='cb({ uiVideoPlayerPath: $event })' />
          <a-popover position='bottom'>
            <IconFont name="iconbulb" />
            <template #content>
              <div class='play-col-wide'>
                <span class='opred'>linux</span>：手动填写一个播放命令
                <hr />
                你必须先自己在电脑上安装（sudo apt install xxx），<br />
                然后才能使用这个播放软件，直接手动填写播放软件的名字
                <div class='hrspace'></div>
                已测试：Mpv，Vlc，totem，mplayer，smplayer，xine，parole，kodi
                <div class='hrspace'></div>
                详情请参阅<span class='opblue'>帮助文档</span>
              </div>
            </template>
          </a-popover>
        </div>
      </div>
    </template>
  </div>


  <div class='settingcard play-settings-card'>
    <div class='play-settings-intro play-settings-intro--secondary'>
      <div class='play-settings-kicker'>Behavior</div>
      <div class='play-settings-copy'>{{ t('settings.play.behaviorIntro') }}</div>
    </div>

    <div class='play-setting-group'>
      <div class='play-setting-header'>
        <div class='settinghead'>{{ t('settings.play.autoMarkWatched') }}</div>
      </div>
      <div class='settingrow play-setting-row'>
      <MySwitch :value='settingStore.uiAutoColorVideo' @update:value='cb({ uiAutoColorVideo: $event })'>
        {{ t('settings.play.autoMarkWatchedSwitch') }}
      </MySwitch>
      </div>
    </div>

    <div class='play-setting-group'>
      <div class='play-setting-header'>
        <div class='settinghead'>{{ t('settings.play.autoSyncProgress') }}</div>
      </div>
      <div class='settingrow play-setting-row'>
      <MySwitch :value='settingStore.uiAutoPlaycursorVideo' @update:value='cb({ uiAutoPlaycursorVideo: $event })'>
        {{ t('settings.play.autoSyncProgressSwitch') }}
      </MySwitch>
      <a-popover position='bottom'>
        <IconFont name="iconbulb" />
        <template #content>
          <div class='play-col-wide'>只有使用 <span class='opblue'>内置网页播放器或者MPV播放器</span> 时才支持同步
            播放进度
          </div>
        </template>
      </a-popover>
      </div>
    </div>

    <div class='play-setting-group'>
      <div class='play-setting-header'>
        <div class='settinghead'>{{ t('settings.play.imagePreviewMode') }}</div>
      </div>
      <div class='settingrow play-setting-row'>
      <a-radio-group type='button' tabindex='-1' :model-value='settingStore.uiImageMode'
                     @update:model-value='cb({ uiImageMode: $event })'>
        <a-radio tabindex='-1' value='fill'>{{ t('settings.play.imageModeFill') }}</a-radio>
        <a-radio tabindex='-1' value='width'>{{ t('settings.play.imageModeWidth') }}</a-radio>
      </a-radio-group>
      </div>
    </div>

    <div class='play-setting-group'>
      <div class='play-setting-header'>
        <div class='settinghead'>{{ t('settings.play.spriteCount') }}</div>
      </div>
      <div class='settingrow play-setting-row'>
      <a-radio-group type='button' tabindex='-1' :model-value='settingStore.uiXBTNumber'
                     @update:model-value='cb({ uiXBTNumber: $event })'>
        <a-radio tabindex='-1' :value='24'>{{ t('settings.play.screenshots24') }}</a-radio>
        <a-radio tabindex='-1' :value='36'>{{ t('settings.play.screenshots36') }}</a-radio>
        <a-radio tabindex='-1' :value='48'>{{ t('settings.play.screenshots48') }}</a-radio>
        <a-radio tabindex='-1' :value='60'>{{ t('settings.play.screenshots60') }}</a-radio>
        <a-radio tabindex='-1' :value='72'>{{ t('settings.play.screenshots72') }}</a-radio>
      </a-radio-group>
      </div>
    </div>
  </div>
</template>

<style scoped>
.play-settings-card {
  overflow: hidden;
}

.play-settings-intro {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 20px;
}

.play-settings-intro--secondary {
  margin-bottom: 18px;
}

.play-settings-kicker {
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

.play-settings-copy {
  max-width: 680px;
  color: var(--color-text-2);
  font-size: 14px;
  line-height: 1.7;
}

.play-setting-group {
  padding: 18px 0;
  border-top: 1px solid rgba(120, 138, 165, 0.14);
}

.play-setting-group:first-of-type {
  border-top: 0;
  padding-top: 0;
}

.play-setting-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.play-setting-row {
  width: 100%;
}
.play-setting-row.settingrow {
  min-width: 0;
}

.play-setting-row--stack {
  align-items: flex-start;
}

.play-player-path {
  width: min(520px, 100%);
}
.play-col-wide { min-width: 400px; }
.play-col-md   { min-width: 200px; }

.play-settings-card :deep(.settinghead) {
  width: auto;
  min-width: 0;
  margin: 0;
  padding: 0;
  white-space: normal;
  line-height: 1.35;
}

.play-settings-card :deep(.settinghead::after) {
  display: none;
}

.play-settings-card :deep(.settingrow) {
  margin-top: 0;
}

.hitText {
  max-width: 720px;
  padding: 8px 12px;
  border: 1px solid rgba(120, 138, 165, 0.18);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.36);
  font-size: 13px;
  color: var(--color-text-2);
  line-height: 1.6;
}

.mpv-status {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}

:global(html.dark) .play-settings-kicker {
  background: rgba(120, 160, 255, 0.2);
  color: #dbe6ff;
}

:global(html.dark) .play-setting-group {
  border-top-color: rgba(140, 158, 183, 0.16);
}

:global(html.dark) .hitText {
  background: rgba(32, 39, 52, 0.5);
  border-color: rgba(140, 158, 183, 0.2);
  color: rgba(236, 242, 255, 0.78);
}

@media (max-width: 960px) {
  .play-setting-header {
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .play-player-path {
    width: 100%;
  }
}
</style>
