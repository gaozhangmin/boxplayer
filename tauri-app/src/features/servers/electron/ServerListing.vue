<script setup lang="ts">
import {computed} from 'vue'
import {Download,Folder} from 'lucide-vue-next'
import ServerArtwork from '../ServerArtwork.vue'
import MediaPosterPlaceholder from '../../library/electron/MediaPosterPlaceholder.vue'
import WatchedIndicator from '../../library/electron/WatchedIndicator.vue'
import PosterRatingBadge from '../../library/electron/PosterRatingBadge.vue'
import type {ServerItem} from '../workspace'
import type {Account} from '../../sources/contracts'
const props=defineProps<{items:ServerItem[];account:Account;mode:'grid'|'list';root?:boolean;landscape?:boolean;selection?:string[];busy?:boolean}>()
const emit=defineEmits<{select:[item:ServerItem];context:[event:MouseEvent,item:ServerItem];watched:[item:ServerItem];download:[item:ServerItem]}>()
const currentListingBrowseMode=computed(()=>props.mode)
const listingCardClass=computed(()=>[props.landscape?'library-card-landscape':'library-card-portrait',props.mode==='list'?'library-card-list':'library-card-grid'])
function isDetailCandidate(item:ServerItem){return !['folder','collectionfolder','userview','section'].includes(item.kind)}
const getListingHeading=(item:ServerItem)=>item.name
const getListingYearLabel=(item:ServerItem)=>item.year
const getListingOverlay=(item:ServerItem)=>item.childCount?String(item.childCount):''
const getListingOverview=(item:ServerItem)=>item.overview
function getListingMetaItems(item:ServerItem){return [item.rating?'★ '+item.rating.toFixed(1):'',item.duration?Math.max(1,Math.round(item.duration/60))+'分钟':'',item.year,item.sortValues?.officialRating,item.height?item.height+'p':''].filter(Boolean)}
</script>
<template><div class="media-server-workspace" :class="{'unified-server-root':root,'unified-server-category':!root}"><div class="library-shell unified-listing" :class="[landscape?'library-shell-landscape':'library-shell-portrait',mode==='list'?'library-shell-list':'library-shell-grid']"><template v-for="item in items" :key="item.id"><div role="button" tabindex="0"


                  class="library-card interactive"
                  :class="[listingCardClass, { 'library-card-hero': root }]"
                  @click="emit('select',item)" @keydown.enter.self.prevent="emit('select',item)" @keydown.space.self.prevent="emit('select',item)"
                  @contextmenu.prevent="emit('context',$event,item)"
                >
                  <div
                    class="library-cover media-image-frame"
                    :class="{
                      'has-image': !!item.imagePath,
                      'library-cover-fallback': !item.imagePath,
                      'library-cover-list': currentListingBrowseMode === 'list' && !root
                    }"
                  >
                    <ServerArtwork v-if="item.imagePath" :account="account" :path="landscape?item.backdropPath||item.imagePath:item.imagePath" :alt="item.name" />
                    <div v-if="root && !item.imagePath" class="root-library-fallback"><Folder :size="56" aria-hidden="true" /></div>
                    <div v-else class="media-card-placeholder media-image-placeholder"><MediaPosterPlaceholder /></div>
                    <div v-if="root && selection" class="root-library-check"><input type="checkbox" :checked="selection?.includes(item.id)" tabindex="-1" :aria-label="item.name" /></div>
                    <div v-if="root && !root" class="library-cover-overlay"></div>
                    <div v-if="root && !root" class="library-cover-title">{{ getListingHeading(item) }}</div>
                    <WatchedIndicator v-if="isDetailCandidate(item)" corner :watched="item.watched" />
                    <PosterRatingBadge :rating="item.rating" :is-movie="item.kind === 'movie'" />
                    <div v-if="getListingOverlay(item)" class="listing-overlay-badge">{{ getListingOverlay(item) }}</div>
                  </div>
                  <h4 v-if="root">{{ getListingHeading(item) }}</h4>
                  <template v-else-if="!root && currentListingBrowseMode === 'grid'">
                    <h4>{{ getListingHeading(item) }}</h4>
                    <div class="library-meta-line">{{ getListingYearLabel(item) }}</div>
                  </template>
                  <template v-else-if="!root">
                    <div class="library-list-body">
                      <div class="library-list-head">
                        <div class="library-list-title-wrap">
                          <h4>{{ getListingHeading(item) }}</h4>
                        </div>
                      </div>
                      <div v-if="getListingMetaItems(item).length > 0" class="library-list-meta">
                        <span
                          v-for="meta in getListingMetaItems(item)"
                          :key="`${item.id}-${meta}`"
                          class="library-list-meta-chip"
                        >
                          {{ meta }}
                        </span>
                      </div>
                      <p class="library-list-overview" :class="{ 'is-empty': !getListingOverview(item) }">
                        {{ getListingOverview(item) || '暂无简介' }}
                      </p>
                      <WatchedIndicator v-if="isDetailCandidate(item)" :watched="item.watched" :disabled="busy" @toggle="emit('watched',item)" />
                      <div v-if="item.genres?.length" class="library-list-genres"><span v-for="genre in item.genres" :key="genre">{{ genre }}</span></div>
                    </div>
                    <button v-if="item.kind !== 'series' && item.kind !== 'season' && isDetailCandidate(item)" type="button" class="server-file-download" :aria-label="'下载'" @click.stop="emit('download',item)" @keydown.enter.stop><Download :size="22" /></button>
                  </template>
                </div></template></div></div></template>
<style scoped src="./workspace.css"></style><style src="./workspace-overrides.css"></style>
<style scoped>
.unified-server-root .library-shell{display:grid;grid-template-columns:repeat(auto-fill,174px);gap:22px}.unified-server-root .library-card{background:transparent;border:0;padding:0;cursor:pointer}.unified-server-root .library-cover{aspect-ratio:2/3;border-radius:16px}.unified-server-root h4{font-size:13px;margin:10px 0 0}.root-library-fallback{height:100%;display:grid;place-items:center;color:var(--primary)}.library-card:focus-visible{outline:2px solid var(--primary);outline-offset:3px}.library-cover :deep(img){position:absolute;inset:0}.library-card{cursor:pointer}
</style>