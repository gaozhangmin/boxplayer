<script setup lang="ts">
/** CustomLyricModal — write or paste custom LRC lyrics for the current track. */
import { ref, watch } from 'vue'

const props = defineProps<{ visible: boolean; trackTitle: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'save', text: string): void; (e: 'delete'): void }>()

const text = ref('')

watch(() => props.visible, (v) => { if (v) text.value = '' })

function onSave() {
  if (!text.value.trim()) return
  emit('save', text.value)
  emit('close')
}
</script>

<template>
  <div v-if="visible" class="lyric-mask" @click.self="emit('close')">
    <div class="lyric-modal">
      <div class="lyric-head">
        <div>
          <div class="lyric-title">自定义歌词</div>
          <div class="lyric-sub">{{ trackTitle || '当前歌曲' }}</div>
        </div>
        <button class="lyric-close" @click="emit('close')">×</button>
      </div>
      <textarea
        v-model="text" class="lyric-input" spellcheck="false"
        placeholder="[00:12.00] 第一行歌词&#10;[00:16.50] 第二行歌词&#10;&#10;没有时间轴也可以，每一行会按歌曲时长自动铺开"
      />
      <div class="lyric-hint">支持 LRC 时间轴，也支持纯文本（自动铺开）</div>
      <div class="lyric-actions">
        <button class="lyric-delete" @click="emit('delete'); emit('close')">删除</button>
        <div class="lyric-spacer" />
        <button class="lyric-cancel" @click="emit('close')">关闭</button>
        <button class="lyric-save" @click="onSave">保存使用</button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.lyric-mask {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0,0,0,.62); backdrop-filter: blur(8px);
  display: flex; align-items: center; justify-content: center;
}
.lyric-modal {
  width: min(560px, calc(100vw - 32px));
  border-radius: 18px; border: 1px solid rgba(0,245,212,.14);
  background: var(--app-overlay-bg);
  box-shadow: 0 28px 80px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.06);
  padding: 18px; color: #fff;
}
.lyric-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
.lyric-title { font-size: 14px; font-weight: 700; }
.lyric-sub { font-size: 11px; color: rgba(255,255,255,.4); margin-top: 4px; }
.lyric-close {
  width: 28px; height: 28px; border-radius: 8px; border: 1px solid rgba(255,255,255,.1);
  background: rgba(255,255,255,.04); color: rgba(255,255,255,.6); cursor: pointer; font-size: 16px;
}
.lyric-close:hover { background: rgba(255,255,255,.1); color: #fff; }
.lyric-input {
  width: 100%; height: 260px; padding: 12px; border-radius: 12px;
  border: 1px solid rgba(255,255,255,.08); background: rgba(10,11,15,.8);
  color: rgba(255,255,255,.85); font-family: 'JetBrains Mono', monospace; font-size: 12px;
  line-height: 1.6; resize: vertical; outline: none;
}
.lyric-input:focus { border-color: rgba(0,245,212,.3); }
.lyric-input::placeholder { color: rgba(255,255,255,.25); }
.lyric-hint { font-size: 10.5px; color: rgba(255,255,255,.32); margin-top: 6px; }
.lyric-actions { display: flex; gap: 8px; margin-top: 12px; align-items: center; }
.lyric-spacer { flex: 1; }
.lyric-delete, .lyric-cancel, .lyric-save {
  height: 34px; padding: 0 14px; border-radius: 10px; font-family: inherit; font-size: 12px; cursor: pointer;
}
.lyric-delete { border: 1px solid rgba(255,86,100,.24); background: rgba(255,86,100,.08); color: rgba(255,122,144,.8); }
.lyric-delete:hover { background: rgba(255,86,100,.16); color: #ff7a90; }
.lyric-cancel { border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.04); color: rgba(255,255,255,.6); }
.lyric-cancel:hover { background: rgba(255,255,255,.08); color: #fff; }
.lyric-save { border: 1px solid rgba(0,245,212,.32); background: rgba(0,245,212,.1); color: #fff; font-weight: 700; }
.lyric-save:hover { background: rgba(0,245,212,.16); border-color: rgba(0,245,212,.5); }
</style>
