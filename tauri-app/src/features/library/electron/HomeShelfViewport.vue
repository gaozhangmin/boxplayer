<script setup lang="ts">
import { nextTick, onMounted, onBeforeUnmount, ref } from 'vue'
const props = defineProps<{ landscape?: boolean; snapshot: { height?: number; scrollLeft?: number } }>()
const emit = defineEmits<{ (event: 'visible', visible: boolean): void }>()
const host = ref<HTMLElement>()
const mounted = ref(false)
const height = ref(props.snapshot.height ?? (props.landscape ? 260 : 340))
let scrollLeft = props.snapshot.scrollLeft || 0
function saveScroll() {
  const row = host.value?.querySelector('.horizontal-row')
  if (row) props.snapshot.scrollLeft = scrollLeft = row.scrollLeft
}
let observer: IntersectionObserver | undefined
let resize: ResizeObserver | undefined
onMounted(() => {
  observer = new IntersectionObserver(async entries => {
    const visible = entries.some(entry => entry.isIntersecting)
    if (visible === mounted.value) return
    if (!visible) saveScroll()
    mounted.value = visible
    emit('visible', visible)
    if (visible) {
      await nextTick()
      const row = host.value?.querySelector('.horizontal-row')
      if (row) row.scrollLeft = scrollLeft
    }
  }, { root: host.value?.closest('.unified-home') || null, rootMargin: '700px 0px' })
  if (host.value) observer.observe(host.value)
  resize = new ResizeObserver(() => {
    // Measure the natural mounted height, including the row's bottom margin.
    // A minimum height here would prevent shorter shelves from ever shrinking.
    if (mounted.value && host.value?.firstElementChild) props.snapshot.height = height.value = host.value.getBoundingClientRect().height
  })
  if (host.value) resize.observe(host.value)
})
onBeforeUnmount(() => { saveScroll(); observer?.disconnect(); resize?.disconnect(); emit('visible', false) })
</script>
<template><div ref="host" class="home-shelf-viewport" :style="mounted ? undefined : { height: height + 'px' }"><slot v-if="mounted" /></div></template>
<style scoped>
/* Keep the shelf margin inside its measured placeholder rather than allowing
   it to collapse through the wrapper when content is mounted. */
.home-shelf-viewport { display: flow-root; }
</style>
