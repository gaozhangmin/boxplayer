<script setup lang="ts">
/** Cover crop modal — drag/zoom a cover image, preview cropped result, commit. */
import { ref, watch, nextTick } from 'vue'

const props = defineProps<{ visible: boolean; imageUrl: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'commit', blob: Blob): void }>()

const stageRef = ref<HTMLDivElement | null>(null)
const previewCanvas = ref<HTMLCanvasElement | null>(null)
const zoom = ref(1)
const offsetX = ref(0)
const offsetY = ref(0)
let img: HTMLImageElement | null = null

watch(() => props.visible, async (v) => {
  if (!v || !props.imageUrl) return
  img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = props.imageUrl
  await new Promise<void>(r => { img!.onload = () => r() })
  zoom.value = 1
  offsetX.value = 0
  offsetY.value = 0
  nextTick(() => drawPreview())
})

function onZoomIn() { zoom.value = Math.min(3.2, +(zoom.value + 0.1).toFixed(2)); drawPreview() }
function onZoomOut() { zoom.value = Math.max(1, +(zoom.value - 0.1).toFixed(2)); drawPreview() }

function drawPreview() {
  const canvas = previewCanvas.value
  if (!canvas || !img) return
  const ctx = canvas.getContext('2d')!
  const size = Math.min(img.width, img.height)
  const sx = (img.width - size) / 2 + offsetX.value
  const sy = (img.height - size) / 2 + offsetY.value
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, sx, sy, size, size, 0, 0, canvas.width, canvas.height)
}

function commit() {
  const canvas = previewCanvas.value
  if (!canvas) return
  canvas.toBlob(b => { if (b) emit('commit', b) }, 'image/png')
  emit('close')
}
</script>

<template>
  <div v-if="visible" class="crop-mask" @click.self="emit('close')">
    <div class="crop-modal">
      <div class="crop-head">
        <span>裁剪封面</span>
        <button class="crop-close" @click="emit('close')">×</button>
      </div>
      <div class="crop-body">
        <div ref="stageRef" class="crop-stage">
          <div class="crop-img-wrap" :style="{ transform: `scale(${zoom}) translate(${offsetX}px, ${offsetY}px)` }">
            <img v-if="imageUrl" :src="imageUrl" alt="" @load="drawPreview" />
          </div>
        </div>
        <div class="crop-side">
          <canvas ref="previewCanvas" width="160" height="160" class="crop-preview" />
          <div class="crop-controls">
            <button class="crop-btn" @click="onZoomOut">−</button>
            <span class="crop-zoom-val">{{ zoom.toFixed(1) }}x</span>
            <button class="crop-btn" @click="onZoomIn">+</button>
          </div>
        </div>
      </div>
      <div class="crop-actions">
        <button class="crop-cancel" @click="emit('close')">取消</button>
        <button class="crop-commit" @click="commit">使用封面</button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.crop-mask {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0,0,0,.62); backdrop-filter: blur(8px);
  display: flex; align-items: center; justify-content: center;
}
.crop-modal {
  width: min(640px, calc(100vw - 32px)); max-height: calc(100vh - 40px);
  border-radius: 18px; border: 1px solid rgba(0,245,212,.14);
  background: var(--app-overlay-bg);
  box-shadow: 0 28px 80px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.06);
  padding: 18px; color: #fff; overflow: hidden;
}
.crop-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.crop-head span { font-size: 14px; font-weight: 700; }
.crop-close {
  width: 28px; height: 28px; border-radius: 8px; border: 1px solid rgba(255,255,255,.1);
  background: rgba(255,255,255,.04); color: rgba(255,255,255,.6); cursor: pointer; font-size: 16px;
}
.crop-close:hover { background: rgba(255,255,255,.1); color: #fff; }
.crop-body { display: grid; grid-template-columns: 1fr 180px; gap: 14px; }
.crop-stage {
  height: 300px; border-radius: 14px; border: 1px solid rgba(255,255,255,.08);
  background: #0a0c10; overflow: hidden; position: relative;
  display: flex; align-items: center; justify-content: center;
}
.crop-stage::after {
  content: ''; position: absolute; inset: 0;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.06);
  pointer-events: none; border-radius: 14px;
}
.crop-img-wrap { transition: transform .15s; display: flex; align-items: center; justify-content: center; }
.crop-img-wrap img { max-width: 100%; max-height: 100%; object-fit: contain; }
.crop-side { display: flex; flex-direction: column; gap: 10px; }
.crop-preview {
  width: 160px; height: 160px; border-radius: 14px; border: 1px solid rgba(255,255,255,.12);
  background: #0a0c10; object-fit: cover;
}
.crop-controls { display: flex; align-items: center; justify-content: center; gap: 12px; }
.crop-btn {
  width: 34px; height: 34px; border-radius: 10px; border: 1px solid rgba(255,255,255,.12);
  background: rgba(255,255,255,.05); color: rgba(255,255,255,.7); cursor: pointer; font-size: 18px;
}
.crop-btn:hover { background: rgba(0,245,212,.1); border-color: rgba(0,245,212,.3); color: #fff; }
.crop-zoom-val { font-size: 12px; color: rgba(255,255,255,.5); font-variant-numeric: tabular-nums; min-width: 36px; text-align: center; }
.crop-actions { display: flex; gap: 10px; margin-top: 14px; justify-content: flex-end; }
.crop-cancel, .crop-commit {
  height: 34px; padding: 0 16px; border-radius: 10px; font-family: inherit; font-size: 12px; cursor: pointer;
}
.crop-cancel {
  border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.04); color: rgba(255,255,255,.6);
}
.crop-cancel:hover { background: rgba(255,255,255,.08); color: #fff; }
.crop-commit {
  border: 1px solid rgba(0,245,212,.32); background: rgba(0,245,212,.1); color: #fff; font-weight: 700;
}
.crop-commit:hover { background: rgba(0,245,212,.16); border-color: rgba(0,245,212,.5); }
</style>
