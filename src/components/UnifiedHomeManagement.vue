<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Check, ChevronLeft, ChevronRight, Menu, Minus, Pencil, Plus, X } from 'lucide-vue-next'
import { t } from '../i18n'
import { categoryRouteForHomeId, isIndependentCategoryRoute } from '../utils/categoryPlacement'
import { homeItemTitle, homeMenuTitle, isHomeItemEnabled, mergeHomeOrder, moveHomeItem, visibleHomeItems, type HomeManagementGroup, type HomeManagementItem, type HomeManagementNode, type UnifiedHomeSettings } from '../utils/unifiedHomeManagement'

const props = defineProps<{ items: HomeManagementItem[]; groups: HomeManagementGroup[]; settings: UnifiedHomeSettings; canEnable?: (id: string) => boolean; placementState?: (id: string) => { home: boolean; favorite: boolean } }>()
const emit = defineEmits<{ (event: 'save', value: UnifiedHomeSettings): void; (event: 'close'): void; (event: 'reset'): void; (event: 'rename', id: string, title: string): void; (event: 'remove-placement', id: string): void }>()
const draft = ref<UnifiedHomeSettings>({ order: mergeHomeOrder(props.settings.order, props.items), hidden: [...props.settings.hidden], titles: { ...props.settings.titles } })
const editing = ref(false)
const path = ref<HomeManagementNode[]>([])
const dragged = ref('')
let dragCleanup: (() => void) | undefined
function startDrag(event: PointerEvent, id: string) {
  if (event.button !== 0 || dragCleanup) return
  const row = (event.currentTarget as HTMLElement).closest('.management-row') as HTMLElement | null
  const scroll = row?.closest('.management-scroll') as HTMLElement | null
  if (!row || !scroll) return
  event.preventDefault()
  const box = row.getBoundingClientRect()
  const originalOrder = [...draft.value.order]
  let pointerY = event.clientY
  let ghost: HTMLElement | undefined
  let frame = 0
  // Vue moves keyed rows when reordering upwards. Capturing on the handle
  // loses capture when that row is moved in the DOM, cancelling the drag.
  // The scroll container stays mounted throughout the entire gesture.
  scroll.setPointerCapture(event.pointerId)
  const update = () => {
    if (!ghost) return
    ghost.style.top = `${pointerY - (event.clientY - box.top)}px`
    const bounds = scroll.getBoundingClientRect()
    if (pointerY < bounds.top + 36) scroll.scrollTop -= 10
    else if (pointerY > bounds.bottom - 36) scroll.scrollTop += 10
    const rows = Array.from(scroll.querySelectorAll<HTMLElement>('[data-sort-id]'))
    const target = rows.reduce<HTMLElement | undefined>((nearest, candidate) => {
      const rect = candidate.getBoundingClientRect()
      const previous = nearest?.getBoundingClientRect()
      return !previous || Math.abs(pointerY - rect.top - rect.height / 2) < Math.abs(pointerY - previous.top - previous.height / 2) ? candidate : nearest
    }, undefined)
    if (target?.dataset.sortId && target.dataset.sortId !== id) draft.value = moveHomeItem(draft.value, visible.value.map(item => item.id), id, target.dataset.sortId)
    frame = requestAnimationFrame(update)
  }
  const pointerMove = (next: PointerEvent) => {
    if (next.pointerId !== event.pointerId) return
    pointerY = next.clientY
    if (!ghost && Math.abs(pointerY - event.clientY) >= 4) {
      ghost = row.cloneNode(true) as HTMLElement
      ghost.removeAttribute('data-sort-id')
      ghost.setAttribute('aria-hidden', 'true')
      Object.assign(ghost.style, { position: 'fixed', left: `${box.left}px`, width: `${box.width}px`, height: `${box.height}px`, margin: '0', zIndex: '10000', pointerEvents: 'none', background: 'var(--color-bg-2, #181818)', color: 'var(--color-text-1)', boxShadow: '0 8px 28px #0008', opacity: '0.96' })
      const label = ghost.querySelector('strong')
      if (label) label.style.fontSize = '18px'
      document.body.appendChild(ghost)
      dragged.value = id
      update()
    }
  }
  const finish = (commit: boolean) => {
    const changed = !!ghost
    dragCleanup = undefined
    cancelAnimationFrame(frame)
    ghost?.remove()
    window.removeEventListener('pointermove', pointerMove)
    window.removeEventListener('pointerup', pointerUp)
    window.removeEventListener('pointercancel', cancel)
    window.removeEventListener('keydown', escape)
    window.removeEventListener('blur', cancel)
    scroll.removeEventListener('lostpointercapture', cancel)
    if (scroll.hasPointerCapture(event.pointerId)) scroll.releasePointerCapture(event.pointerId)
    dragged.value = ''
    if (!commit) draft.value.order = originalOrder
    else if (changed) emit('save', draft.value)
  }
  const pointerUp = (next: PointerEvent) => { if (next.pointerId === event.pointerId) finish(true) }
  const cancel = () => finish(false)
  const escape = (next: KeyboardEvent) => { if (next.key === 'Escape') { next.stopPropagation(); finish(false) } }
  window.addEventListener('pointermove', pointerMove)
  window.addEventListener('pointerup', pointerUp)
  window.addEventListener('pointercancel', cancel)
  window.addEventListener('keydown', escape)
  window.addEventListener('blur', cancel)
  scroll.addEventListener('lostpointercapture', cancel)
  dragCleanup = cancel
}
onBeforeUnmount(() => dragCleanup?.())
const renameTarget = ref<HomeManagementItem>()
const renameText = ref('')
const favoriteOnly = (item: HomeManagementItem) => {
  // A media server category's Favorites card never counts as a Home shelf.
  if (isIndependentCategoryRoute(categoryRouteForHomeId(item.id))) return false
  const state = props.placementState?.(item.id)
  return !!state?.favorite && !state.home
}
const visible = computed(() => visibleHomeItems(props.items, draft.value))
const nodesById = computed(() => {
  const flatten = (nodes: HomeManagementNode[]): HomeManagementNode[] => nodes.flatMap(node => [node, ...flatten(node.children || [])])
  return new Map(props.groups.flatMap(group => flatten(group.nodes)).map(node => [node.id, node]))
})
const displayNodes = computed<HomeManagementNode[]>(() => visible.value.map(item => ({
  id: item.id, title: item.title, item, children: nodesById.value.get(item.id)?.children,
  expandable: nodesById.value.get(item.id)?.expandable
})))
// Resolve open levels from the latest catalog, not the snapshot from the click.
const currentNode = computed(() => {
  const opened = path.value.at(-1)
  return opened ? nodesById.value.get(opened.id) || opened : undefined
})
const currentNodes = computed(() => currentNode.value?.children || [])
const currentTitle = computed(() => currentNode.value?.title || t('libraryBrowse.addHome'))
function title(item: HomeManagementItem) { return homeItemTitle(item, draft.value) }
function toggle(item: HomeManagementItem) {
  const enabled = isHomeItemEnabled(item, draft.value)
  if (!enabled && favoriteOnly(item)) { emit('remove-placement', item.id); return }
  if (!enabled && props.canEnable?.(item.id) === false) return
  draft.value.hidden = enabled ? [...draft.value.hidden, item.id] : draft.value.hidden.filter(id => id !== item.id)
  if (!enabled && !draft.value.order.includes(item.id)) draft.value.order.push(item.id)
}
function enabled(item: HomeManagementItem) { return isHomeItemEnabled(item, draft.value) || favoriteOnly(item) }
function save() { emit('save', draft.value); emit('close') }
function move(id: string, target: string) {
  draft.value = moveHomeItem(draft.value, visible.value.map(item => item.id), id, target)
  emit('save', draft.value)
}
function moveBy(id: string, delta: number) {
  const index = visible.value.findIndex(item => item.id === id)
  const target = visible.value[index + delta]
  if (target) move(id, target.id)
}
function beginRename(item: HomeManagementItem) { renameTarget.value = item; renameText.value = title(item) }
function rename() {
  const name = renameText.value.trim()
  if (!renameTarget.value || !name) return
  draft.value.titles = { ...draft.value.titles, [renameTarget.value.id]: name }
  emit('rename', renameTarget.value.id, name)
  renameTarget.value = undefined
}
watch(() => props.items, items => { draft.value.order = mergeHomeOrder(draft.value.order, items) })
</script>

<template>
  <div class="home-management" :class="{ 'sorting-view': !editing }" data-testid="unified-home-management">
    <header>
      <button class="circle" :aria-label="path.length ? t('unified.back') : t('common.close')" @click="path.length ? path.pop() : emit('close')"><ChevronLeft v-if="path.length" :size="20" /><X v-else :size="18" /></button>
      <h2>{{ editing ? currentTitle : t('libraryBrowse.addHome') }}</h2>
      <button v-if="editing" class="circle confirm" :aria-label="t('common.save')" @click="save"><Check :size="22" /></button>
      <button v-else class="edit" @click="editing = true">{{ t('unified.edit') }}</button>
    </header>
    <div class="management-scroll">
      <template v-if="!editing">
        <h3>{{ t('unified.displayItems') }}</h3>
        <div v-for="item in visible" :key="item.id" class="management-row" :data-sort-id="item.id" :class="{ 'is-dragging': dragged === item.id }">
          <strong>{{ homeMenuTitle(item, draft) }}</strong><button class="icon reorder-handle" :aria-label="t('unified.reorder', { name: title(item) })" @pointerdown.stop="startDrag($event, item.id)" @dragstart.prevent @keydown.up.prevent="moveBy(item.id, -1)" @keydown.down.prevent="moveBy(item.id, 1)"><Menu :size="22" :stroke-width="1.5" /></button>
        </div>
      </template>
      <template v-else>
        <p v-if="path.length && !currentNodes.length" class="management-empty" role="status">{{ t('libraryBrowse.empty') }}</p>
        <template v-for="group in path.length ? [{ id: 'current', title: '', nodes: currentNodes }] : [{ id: 'display', title: t('unified.displayItems'), nodes: displayNodes }, ...groups]" :key="group.id">
          <h3 v-if="group.title">{{ group.title }}</h3>
          <div v-for="node in group.nodes" :key="node.id" class="management-row">
            <button v-if="group.id !== 'display' && (node.expandable || node.children?.length)" class="node-title" @click="path.push(node)">{{ node.title }}</button><strong v-else>{{ group.id === 'display' && node.item ? homeMenuTitle(node.item, draft) : node.title }}</strong>
            <button v-if="group.id !== 'display' && (node.expandable || node.children?.length)" class="icon" :aria-label="t('common.open')" @click="path.push(node)"><ChevronRight :size="17" /></button>
            <button v-if="group.id === 'display' && node.item && node.id !== 'sources'" class="icon" :aria-label="t('file.rename')" @click="beginRename(node.item)"><Pencil :size="17" /></button>
            <button v-if="node.item" class="visibility" :disabled="!enabled(node.item) && canEnable?.(node.item.id) === false" :class="{ hidden: !enabled(node.item) }" :aria-label="t(!enabled(node.item) ? 'unified.showItem' : 'unified.hideItem', { name: title(node.item) })" @click="toggle(node.item)"><Plus v-if="!enabled(node.item)" :size="13" /><Minus v-else :size="13" /></button>
          </div>
        </template>
      </template>
    </div>
    <button v-if="!editing" class="reset" @click="emit('reset'); emit('close')">{{ t('unified.restoreOrder') }}</button>
    <a-modal :visible="!!renameTarget" :title="t('file.rename')" :ok-button-props="{ disabled: !renameText.trim() }" @ok="rename" @cancel="renameTarget = undefined"><a-input v-model="renameText" :aria-label="t('file.rename')" @press-enter="rename" /></a-modal>
  </div>
</template>

<style scoped>
.management-empty { padding: 24px 8px; color: var(--color-text-3); text-align: center; }
.home-management{width:100%;min-width:0;box-sizing:border-box}
.management-scroll{width:100%;min-width:0;box-sizing:border-box;scrollbar-gutter:stable}
.management-row{width:100%;box-sizing:border-box}
.reorder-handle{cursor:grab}.reorder-handle:active{cursor:grabbing}.reorder-handle svg{pointer-events:none}
.management-row.is-dragging{opacity:.2}
.management-row.drop-target{background:var(--color-fill-2);outline:1px solid #ff8b25;outline-offset:-1px}
.home-management{height:min(720px,80vh);display:flex;flex-direction:column;color:var(--color-text-1)}header{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;gap:12px}h2{font-size:15px;margin:0;text-align:center;flex:1}button{font:inherit;color:inherit;cursor:pointer}.circle,.edit{border:1px solid var(--color-border-2);background:var(--color-fill-2);height:36px;display:grid;place-items:center;border-radius:50%;min-width:36px}.edit{border-radius:20px;padding:0 16px}.confirm{background:#ff8b25;color:white;border:0}.management-scroll{flex:1;overflow:auto;padding:8px 68px 20px}.management-row{display:flex;align-items:center;gap:12px;min-height:48px;padding:0 16px;margin:10px 0;background:var(--color-fill-3);border-radius:10px}.management-row strong,.node-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;font-weight:600;font-size:13px}.node-title,.icon{border:0;background:transparent;padding:4px}.icon{display:grid;place-items:center;color:var(--color-text-3)}.visibility{width:17px;height:17px;display:grid;place-items:center;border:0;border-radius:50%;background:#ff4848;color:white;padding:0;flex-shrink:0}.visibility.hidden{background:#30c653}h3{font-size:13px;color:var(--color-text-3);margin:18px 16px 6px}.reset{margin:0 68px 20px;border:0;background:var(--color-fill-3);border-radius:10px;padding:10px}button:focus-visible{outline:2px solid #ff8b25;outline-offset:3px}.management-row[draggable]{cursor:grab}@media(max-width:700px){.management-scroll{padding:8px 20px}.reset{margin:0 20px 20px}}
.management-scroll{padding:8px 16px 20px}.management-row{min-height:44px;height:44px;margin:0;border-radius:0;background:transparent;border-bottom:1px solid var(--color-border-2);padding:0 8px}.management-row strong,.node-title{font-size:15px;font-weight:400}.icon{width:36px;height:44px;flex-shrink:0}.visibility{width:22px;height:22px;margin:0 6px}h3{margin:22px 8px 0;padding-bottom:8px;border-bottom:1px solid var(--color-border-2)}.confirm{background:var(--app-accent,#ff8b25)}.reset{margin:12px 16px 20px;border-radius:0;background:transparent;border-top:1px solid var(--color-border-2);border-bottom:1px solid var(--color-border-2);text-align:left}
.sorting-view header{padding:18px 20px 24px;position:relative}
.sorting-view header h2{font-size:20px;font-weight:600;position:absolute;left:50%;transform:translateX(-50%);pointer-events:none}
.sorting-view .circle{width:48px;height:48px}.sorting-view .circle svg{width:26px;height:26px}
.sorting-view .edit{height:48px;padding:0 22px;border-radius:28px;font-size:18px}
.sorting-view .management-scroll{padding:0 20px 0}
.sorting-view h3{margin:12px 0 0;padding:12px 0 10px;font-size:15px;font-weight:600}
.sorting-view .management-row{height:52px;padding:0;user-select:none}
.sorting-view .management-row strong{font-size:18px;font-weight:400}
.sorting-view .reorder-handle{width:44px;height:52px;touch-action:none;user-select:none;-webkit-app-region:no-drag}
.sorting-view .reset{flex-shrink:0;margin:28px 0 20px;padding:16px 20px;color:var(--app-accent,#ff8b25);font-size:16px}
</style>
<style>
.unified-home-management-modal.arco-modal{width:660px!important;max-width:calc(100vw - 32px)!important}
.unified-home-management-modal .arco-modal-body{width:100%;box-sizing:border-box}
.unified-home-management-modal:has(.sorting-view){background: var(--app-overlay-bg)}
body[arco-theme='dark'] .unified-home-management-modal:has(.sorting-view){background: var(--app-overlay-bg)}
</style>
