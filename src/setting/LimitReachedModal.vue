<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { X, Film, Cloud, Sparkles, Languages, AudioLines, RefreshCw } from 'lucide-vue-next'
import { openExternal } from '../utils/electronhelper'
import message from '../utils/message'
import { buildProPurchaseUrlForCurrentSession } from '../utils/boxplayerAuth'
import { t, useLocale } from '../i18n'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ 'update:visible': [v: boolean] }>()
const locale = useLocale()
const en = computed(() => locale.value === 'en-US')
const upgrading = ref(false)
const plans = computed(() => [
  { name: en.value ? 'Monthly' : '每月', price: '$1.4', note: en.value ? 'Billed monthly' : '按月订阅' },
  { name: en.value ? 'Yearly' : '每年', price: '$13.3', note: en.value ? 'Billed yearly' : '按年订阅', popular: true },
  { name: en.value ? 'Lifetime' : '终身', price: '$139', note: en.value ? 'Lifetime Pro access' : '全平台终身专业版' }
])
const features = computed(() => [
  { icon: Film, title: t('upgrade.videoMusicPlayback'), desc: en.value ? 'Enjoy your videos and music in one media library.' : '在统一媒体库中浏览与播放视频、音乐。' },
  { icon: Cloud, title: t('upgrade.multiDrive'), desc: en.value ? 'Connect cloud drives and browse files across services.' : '连接多个网盘，集中管理与浏览云端文件。' },
  { icon: Sparkles, title: t('upgrade.builtInAi'), desc: en.value ? 'Search, read and organize with built-in AI.' : '使用内置 AI，协助搜索、阅读与内容整理。' },
  { icon: Languages, title: t('upgrade.instantTranslate'), desc: en.value ? 'Read with AI assistance and instant translation.' : '通过 AI 阅读助手和即时翻译，轻松理解内容。' },
  { icon: AudioLines, title: t('upgrade.localTts'), desc: en.value ? 'Listen to your books with local text-to-speech.' : '使用本地语音朗读，随时聆听书籍内容。' },
  { icon: RefreshCw, title: en.value ? 'Ongoing updates' : '持续更新', desc: en.value ? 'Keep enjoying new features and improvements.' : '持续获得功能更新与体验优化。' }
])
function close() { emit('update:visible', false) }
const dialog = ref<HTMLElement>()
let previousFocus: HTMLElement | null = null
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
  if (event.key !== 'Tab') return
  const buttons = dialog.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
  if (!buttons?.length) return
  const first = buttons[0], last = buttons[buttons.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
watch(() => props.visible, async visible => {
  if (visible) {
    previousFocus = document.activeElement as HTMLElement
    window.addEventListener('keydown', onKey)
    await nextTick()
    dialog.value?.querySelector<HTMLButtonElement>('button')?.focus()
  } else {
    window.removeEventListener('keydown', onKey)
    previousFocus?.focus()
  }
}, { immediate: true })
onUnmounted(() => window.removeEventListener('keydown', onKey))
async function handleUpgrade() {
  if (upgrading.value) return
  upgrading.value = true
  try { openExternal(await buildProPurchaseUrlForCurrentSession()) }
  catch (error: any) { message.error(error?.message || t('settings.upgradeOpening')) }
  finally { upgrading.value = false }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="lim-mask" @click.self="close">
      <section ref="dialog" class="lim-modal" role="dialog" aria-modal="true" aria-labelledby="bp-upgrade-title">
        <header class="lim-header">
          <button class="lim-close" :aria-label="en ? 'Close' : '关闭'" autofocus @click="close"><X :size="22" /></button>
          <h2 id="bp-upgrade-title">{{ en ? 'Upgrade to BoxPlayer PRO' : '升级到 BoxPlayer PRO' }}</h2>
          <span class="lim-platforms">{{ en ? 'All platforms' : '全平台通用' }}</span>
        </header>
        <div class="lim-content">
          <div class="lim-plans">
            <button v-for="plan in plans" :key="plan.name" class="lim-plan" :disabled="upgrading" @click="handleUpgrade">
              <span v-if="plan.popular" class="lim-popular">{{ en ? 'Most popular' : '最受欢迎' }}</span>
              <strong>{{ plan.name }}</strong><span class="lim-price">{{ plan.price }}</span><span class="lim-plan-note">{{ plan.note }}</span>
            </button>
          </div>
          <div class="lim-features">
            <article v-for="feature in features" :key="feature.title" class="lim-feature">
              <component :is="feature.icon" :size="40" :stroke-width="1.5" />
              <div><h3>{{ feature.title }}</h3><p>{{ feature.desc }}</p></div>
            </article>
          </div>
          <p class="lim-note">{{ en ? 'Prices in USD. Select any plan to sign in and purchase on the official website. Final pricing, benefits and subscription terms are shown at checkout.' : '价格单位为美元。点击任意价格卡片，即可前往官网登录并购买。最终价格、权益与订阅条款以官网结算页面为准。' }}</p>
          <p v-if="upgrading" class="lim-note" role="status">{{ en ? 'Opening website…' : '正在打开官网…' }}</p>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.lim-mask{position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;background:#0006;backdrop-filter:blur(8px)}
.lim-modal{width:880px;max-width:100%;max-height:calc(100dvh - 48px);overflow:auto;border:1px solid var(--color-border-2);border-radius:22px;background:var(--color-bg-2);color:var(--color-text-1);box-shadow:0 24px 90px #0004}
.lim-header{display:grid;grid-template-columns:130px 1fr 130px;align-items:center;gap:12px;padding:12px 14px}.lim-header h2{margin:0;text-align:center;font-size:16px;font-weight:700}.lim-close{display:grid;place-items:center;width:38px;height:38px;border:1px solid var(--color-border-2);border-radius:50%;background:var(--color-fill-1);color:var(--color-text-1);cursor:pointer}.lim-platforms{text-align:right;font-size:12px;color:var(--color-text-3)}
.lim-content{padding:42px 48px 24px}.lim-plans{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.lim-plan{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:12px;min-height:164px;padding:30px 22px 24px;border:1px solid var(--color-border-1);border-radius:22px;background:var(--color-bg-1);color:var(--color-text-1);font:inherit;text-align:left;box-shadow:0 8px 26px #0000000c;cursor:pointer;transition:transform .15s,box-shadow .15s}.lim-plan:hover{transform:translateY(-3px);box-shadow:0 10px 28px #ff8a0020}.lim-plan:disabled{opacity:.6;cursor:wait}.lim-plan strong{font-size:20px}.lim-price{color:#ff8a00;font-size:36px;font-weight:750;line-height:1.1}.lim-plan-note{font-size:13px;color:var(--color-text-3)}.lim-popular{position:absolute;top:-17px;left:50%;transform:translateX(-50%);padding:7px 18px;border-radius:11px;background:#ff8a00;color:#fff;font-weight:700;white-space:nowrap}
.lim-features{display:grid;grid-template-columns:1fr 1fr;column-gap:32px;row-gap:36px;margin:44px 0 34px}.lim-feature{display:flex;align-items:flex-start;gap:16px}.lim-feature>svg{flex-shrink:0;color:#ff8a00}.lim-feature h3{margin:0 0 6px;font-size:15px}.lim-feature p{margin:0;font-size:12px;line-height:1.6;color:var(--color-text-2)}.lim-note{margin:0;font-size:12px;line-height:1.6;color:var(--color-text-3)}button:focus-visible{outline:2px solid #ff8a00;outline-offset:4px}
@media(max-width:680px){.lim-content{padding:34px 20px 20px}.lim-header{grid-template-columns:38px 1fr 38px}.lim-platforms{display:none}.lim-plans{gap:10px}.lim-plan{padding:28px 12px 18px;min-height:140px}.lim-price{font-size:28px}.lim-plan strong{font-size:17px}.lim-features{gap:24px 18px}.lim-feature{gap:10px}.lim-feature>svg{width:28px}.lim-popular{padding:6px 10px;font-size:12px}}
@media(max-width:440px){.lim-mask{padding:12px}.lim-modal{max-height:calc(100dvh - 24px)}.lim-plans{grid-template-columns:1fr}.lim-plan{min-height:0;padding:24px}.lim-plans{gap:26px}.lim-features{grid-template-columns:1fr}}
</style>
