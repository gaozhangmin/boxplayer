<script setup lang="ts">
import { X, Shuffle, Repeat, Repeat1, Infinity, Blend } from 'lucide-vue-next'
import type { IPageMusicTrack } from '../../store/appstore'
import { t as tt } from '../../i18n'

const props = defineProps<{
  shuffled?: boolean
  repeatOne?: boolean
  automaticContinuation?: boolean
  crossfade?: boolean
  crossfadeAvailable?: boolean
  visible: boolean
  tracks: IPageMusicTrack[]
  currentIndex: number
}>()

const emit = defineEmits<{
  (e: 'shuffle'): void
  (e: 'repeat'): void
  (e: 'automatic-continuation'): void
  (e: 'crossfade'): void
  (e: 'close'): void
  (e: 'play', index: number): void
  (e: 'remove', index: number): void
}>()

</script>

<template>
  <div v-if="visible" :class="['mini-queue-pop', 'mini-queue-popover', visible ? 'show' : '']" @click.stop>
    <div class="mini-queue-head">
      <span class="mini-queue-title">{{ tt('music.currentQueue') }}</span>
      <span class="mini-queue-count">{{ tracks.length }} {{ tt('music.tracksUnit') }}</span>
      <button class="mini-queue-close" @click="emit('close')"><X :size="14" /></button>
    </div>
    <div class="music-queue-controls">
      <button :aria-label="tt('music.modeShuffle')" :aria-pressed="!!shuffled" :class="{ active: shuffled }" @click="emit('shuffle')"><Shuffle :size="20" /></button>
      <button :aria-label="tt(repeatOne ? 'music.modeLoopOne' : 'music.modeLoopList')" :aria-pressed="!!repeatOne" @click="emit('repeat')"><Repeat1 v-if="repeatOne" :size="20" /><Repeat v-else :size="20" /></button>
      <button :aria-label="tt('music.automaticContinuation')" :aria-pressed="!!automaticContinuation" :class="{ active: automaticContinuation }" @click="emit('automatic-continuation')"><Infinity :size="20" /></button>
      <button :title="tt(crossfadeAvailable ? 'music.crossfadeThreeSeconds' : 'music.crossfadeRequiresUpdatedCore')" :aria-label="tt('music.crossfadeThreeSeconds')" :aria-pressed="!!crossfade" :class="{ active: crossfade }" :disabled="!crossfadeAvailable" @click="emit('crossfade')"><Blend :size="20" /></button>
    </div>
    <div class="mini-queue-list">
      <div
        v-for="(track, index) in tracks"
        :key="`${track.user_id}:${track.drive_id}:${track.file_id}:${index}`"
        :class="['mini-queue-row', index === currentIndex ? 'now' : '']"
        @click="emit('play', index)"
      >
        <span class="mini-queue-idx">{{ index + 1 }}</span>
        <span class="mini-queue-name">{{ track.file_name }}</span>
        <button class="mini-queue-rm" @click.stop="emit('remove', index)" :title="tt('music.remove')">×</button>
      </div>
      <div v-if="!tracks.length" class="mini-queue-empty">{{ tt('music.queueEmpty') }}</div>
    </div>
  </div>
</template>

<style scoped lang="less">
.mini-queue-pop {
  position: absolute;
  bottom: 118px;
  left: 50%;
  transform: translateX(-50%) translateY(8px) scale(.96);
  width: min(400px, calc(100vw - 32px));
  max-height: 360px;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid rgba(0,245,212,.14);
  background: linear-gradient(145deg, rgba(18,18,23,.88), rgba(8,8,12,.94));
  backdrop-filter: blur(28px) saturate(1.1);
  box-shadow: 0 22px 64px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.06);
  opacity: 0;
  pointer-events: none;
  transition: opacity .2s, transform .2s;
  z-index: 12;
  overflow: hidden;
}
.mini-queue-pop.show { opacity: 1; pointer-events: auto; transform: translateX(-50%) translateY(0) scale(1); }
.mini-queue-head {
  display: flex; align-items: center; gap: 10px; margin-bottom: 8px;
}
.mini-queue-title { font-size: 12px; font-weight: 700; color: rgba(255,255,255,.9); }
.mini-queue-count { font-size: 10.5px; color: rgba(255,255,255,.4); flex: 1; }
.mini-queue-close {
  width: 24px; height: 24px; border: 1px solid rgba(255,255,255,.1); border-radius: 6px;
  background: rgba(255,255,255,.04); color: rgba(255,255,255,.5); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.mini-queue-close:hover { background: rgba(255,255,255,.1); color: #fff; }
.mini-queue-list { display: flex; flex-direction: column; gap: 4px; max-height: 280px; overflow-y: auto; }
.mini-queue-row {
  display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,.04); background: rgba(255,255,255,.025); cursor: pointer;
  transition: all .15s;
}
.mini-queue-row:hover { background: rgba(0,245,212,.07); border-color: rgba(0,245,212,.18); }
.mini-queue-row.now { border-color: rgba(0,245,212,.32); background: rgba(0,245,212,.075); }
.mini-queue-idx { font-size: 10.5px; color: rgba(255,255,255,.34); width: 20px; text-align: right; }
.mini-queue-name { flex: 1; font-size: 11.5px; color: rgba(255,255,255,.85); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mini-queue-rm { width: 22px; height: 22px; border: none; border-radius: 5px; background: rgba(255,255,255,.06); color: rgba(255,255,255,.45); cursor: pointer; font-size: 14px; }
.mini-queue-rm:hover { background: rgba(255,86,100,.7); color: #fff; }
.mini-queue-empty { padding: 20px; text-align: center; color: rgba(255,255,255,.32); font-size: 11px; }
.library-queue-drawer { position:fixed; left:auto; right:24px; bottom:100px; z-index:110; transform:none!important; background:var(--color-bg-popup); color:var(--color-text-1); border-color:var(--color-border-2); }
.library-queue-drawer .mini-queue-name,.library-queue-drawer .mini-queue-title { color:var(--color-text-1); }
</style>

<style scoped>
.music-queue-controls { display:flex; gap:6px; margin-bottom:10px; }
.music-queue-controls button { flex:1; display:flex; justify-content:center; align-items:center; height:38px; border:0; border-radius:20px; background:#ffffff14; color:inherit; cursor:pointer; }
.music-queue-controls button.active { background:#ffffff40; }
.music-queue-controls button:disabled { opacity:.35; cursor:default; }
</style>
