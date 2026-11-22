<script setup lang='ts'>
import { openExternal } from '../utils/electronhelper'

function openSupport() {
  openExternal('https://boxplayer.cc/support/')
}
</script>

<template>
  <div class='settingcard'>
    <div class='settinghead'>功能与反馈</div>
    <div class='settingrow feedback-row'>
      <span class='feedback-text'>更多 AI 能力正在开发中。遇到问题或需要新功能？提交工单告诉我们。</span>
      <a-button type='outline' size='small' @click='openSupport'>提交反馈</a-button>
    </div>
  </div>
</template>

<style scoped>
.feedback-row { justify-content: space-between; max-width: 640px; }
.feedback-text { color: var(--color-text-3); font-size: 13px; line-height: 1.6; }
</style>
