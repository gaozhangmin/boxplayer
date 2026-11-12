<script setup lang="ts">
import { computed } from 'vue'
import { Play, Repeat, Shuffle, House, Star, Pencil, RefreshCw, Move, Trash2, Eye, EyeOff, ListPlus, SquareCheck, Image } from 'lucide-vue-next'
import { t } from '../i18n'
import useCategoryPlacement from '../store/categoryPlacement'
import { isIndependentCategoryRoute } from '../utils/categoryPlacement'
const props = defineProps<{ route: string; toolbar?: boolean; hiddenOnHome?: boolean }>()
const emit = defineEmits<{ action: [action: string] }>()
const placement = useCategoryPlacement()
const placed = computed(() => placement.state(props.route).placed)
// Media server categories: Favorites only here; their Home shelf lives in the Add to Home sheet.
const serverCategory = computed(() => isIndependentCategoryRoute(props.route))
const favorite = computed(() => placement.state(props.route).favorite)
const playlist = computed(() => props.route.startsWith('playlist/'))
const series = computed(() => props.route.startsWith('custom-series/'))
const group = computed(() => playlist.value || series.value || props.route.split('/').length >= 3)
function run(action: string) { window.dispatchEvent(new CustomEvent('boxplayer:library-object-action', { detail: { route: props.route, action } })); emit('action', action) }
</script>
<template>
  <div class="library-object-actions" role="menu">
    <template v-if="!toolbar || playlist || series">
      <button role="menuitem" @click="run('play')"><Play :size="18" />{{ t('unified.play') }}</button>
      <button role="menuitem" @click="run('loop')"><Repeat :size="18" />{{ t('unified.loopPlay') }}</button>
      <button v-if="series" role="menuitem" @click="run('select')"><SquareCheck :size="18" />{{ t('unified.selectItems') }}</button>
      <button role="menuitem" @click="run('shuffle')"><Shuffle :size="18" />{{ t('unified.shufflePlay') }}</button>
    </template>
    <template v-if="serverCategory">
      <template v-if="favorite">
        <button class="destructive" role="menuitem" @click="run('removeFavorite')"><Star :size="18" />{{ t('unified.removeFavoriteFolder') }}</button>
        <button role="menuitem" @click="run('renameFavorite')"><Pencil :size="18" />{{ t('unified.renameCollection') }}</button>
        <!-- Hiding only takes the card off Home; Files keeps it. -->
        <button role="menuitem" @click="run(props.hiddenOnHome ? 'showFavorite' : 'hideFavorite')"><component :is="props.hiddenOnHome ? Eye : EyeOff" :size="18" />{{ t(props.hiddenOnHome ? 'unified.showFavoriteOnHome' : 'unified.hideFavoriteOnHome') }}</button>
        <button role="menuitem" @click="run('favoriteCover')"><Image :size="18" />{{ t('unified.cover') }}</button>
      </template>
      <button v-else role="menuitem" @click="run('favorite')"><Star :size="18" />{{ t('unified.addToFavorites') }}</button>
    </template>
    <template v-else-if="placed">
      <button role="menuitem" @click="run('remove')"><House :size="18" />{{ t('unified.removeHome') }}</button>
      <button role="menuitem" @click="run('renameFavorite')"><Pencil :size="18" />{{ t('unified.renameCollection') }}</button>
    </template>
    <template v-else>
      <button role="menuitem" @click="run('favorite')"><Star :size="18" />{{ t('unified.addToFavorites') }}</button>
      <button role="menuitem" @click="run('home')"><House :size="18" />{{ t('libraryBrowse.addHome') }}</button>
    </template>
    <template v-if="series">
      <button v-if="!toolbar" role="menuitem" @click="run('watched')"><Eye :size="18" />{{ t('mediaServer.markWatched') }}</button>
      <button v-if="!toolbar" role="menuitem" @click="run('unwatched')"><EyeOff :size="18" />{{ t('mediaServer.markUnwatched') }}</button>
      <button role="menuitem" @click="run('playlist')"><ListPlus :size="18" />{{ t('media.playlist') }}</button>
    </template>
    <button v-if="group && !series" role="menuitem" @click="run('cover')"><RefreshCw :size="18" />{{ t(playlist ? 'libraryObject.refreshPlaylistCover' : 'libraryObject.refreshCategoryCover') }}</button>
    <template v-if="playlist || series">
      <button role="menuitem" @click="run('rename')"><Pencil :size="18" />{{ t(playlist ? 'libraryObject.renamePlaylist' : 'customSeries.rename') }}</button>
      <button v-if="!toolbar" role="menuitem" @click="run('reorder')"><Move :size="18" />{{ t('unified.sourceReorder') }}</button>
      <button class="destructive" role="menuitem" @click="run('delete')"><Trash2 :size="18" />{{ t(playlist ? 'libraryObject.deletePlaylist' : 'libraryObject.deleteSeries') }}</button>
    </template>
  </div>
</template>
<style scoped>
.library-object-actions{display:flex;flex-direction:column;min-width:210px;padding:4px}
button{display:flex;align-items:center;gap:10px;border:0;background:transparent;color:inherit;padding:10px 14px;text-align:left;cursor:pointer;font:inherit}
button svg{color:#ff8800}button:hover{background:var(--color-fill-2)}button.destructive,button.destructive svg{color:#f53f3f}
</style>
