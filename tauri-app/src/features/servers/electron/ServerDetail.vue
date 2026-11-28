<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import MediaDetailPage from '@/components/media-detail/MediaDetailPage.vue'
import MediaDetailInfo from '@/components/media-detail/MediaDetailInfo.vue'
import {nativeCall} from '@/platform/native'
import WatchedIndicator from '../../library/electron/WatchedIndicator.vue'
import PosterRatingBadge from '../../library/electron/PosterRatingBadge.vue'
import ElectronModal from '@/components/dialog/ElectronModal.vue'
import {ListPlus,Ellipsis,ChevronDown,Eye,EyeOff,Star,Heart,Download,Play} from 'lucide-vue-next'
import ServerArtwork from '../ServerArtwork.vue'
import MediaPosterMenu from './MediaPosterMenu.vue'
import MediaSourceRatings from '../../library/electron/MediaSourceRatings.vue'
import ElectronTrigger from './ElectronTrigger.vue'
import type {ServerItem,ServerPerson,StreamKind,StreamSelection,MediaInfoCard} from '../workspace'
import type {Account} from '../../sources/contracts'
import {setServerPlaybackSource,getServerPlaybackSource} from '../../sources/serverVersions'
import {generalPreferences} from '../../library/displayPreferences'
const props=defineProps<{item:ServerItem;account:Account;children:ServerItem[];episodes?:ServerItem[];selectedSeasonId?:string;similar:ServerItem[];busy?:boolean;menuEntries:{id:string;label:string;disabled?:boolean}[]}>()
const emit=defineEmits<{back:[];play:[item:ServerItem,tracks?:StreamSelection];action:[action:string,item:ServerItem];select:[item:ServerItem];person:[person:ServerPerson];facet:[kind:'genre'|'studio',value:string];season:[item:ServerItem]}>()
const mediaInfo=ref<import('../workspace').MediaInfoCard>()
const selectedEpisode=ref<ServerItem>(),selectedVersion=ref('')
const displayed=computed(()=>selectedEpisode.value||props.item)
const versions=computed(()=>displayed.value.versions||[])
const selectedSourceOption=computed(()=>versions.value.find(v=>v.id===selectedVersion.value)||versions.value[0])
const selectedCards=ref<Partial<Record<StreamKind,string>>>({})
watch([()=>displayed.value.id,()=>selectedSourceOption.value?.id],()=>{selectedCards.value={}},{flush:'post'})
const streamCards=computed(()=>(selectedSourceOption.value?.mediaInfoCards||[]).map(card=>({
 ...card,selected:selectedCards.value[card.kind] ? selectedCards.value[card.kind]===card.id : card.selected
})))
function selectStream(card:MediaInfoCard){selectedCards.value={...selectedCards.value,[card.kind]:card.id}}
function playDetail(){
 const tracks:StreamSelection={}
 for(const card of streamCards.value)if(selectedCards.value[card.kind]===card.id)tracks[card.kind]=card.choice
 emit('play',displayed.value,tracks)
}
function selectVersion(id:string){selectedVersion.value=id;setServerPlaybackSource(props.account.id,displayed.value.id,id)}

const detailBackdropUrl=computed(()=>props.item.backdropPath),detailLogoUrl=computed(()=>props.item.logoPath)
const detailIsWatched=computed(()=>displayed.value.watched),detailIsFavorite=computed(()=>displayed.value.favorite)
const playable=computed(()=>displayed.value.playable||props.children.some(i=>i.playable)||props.children.some(i=>['season','show','series'].includes(i.kind)))
const detailPlayResume=computed(()=>displayed.value.progress?{percent:displayed.value.progress}:undefined)
const detailPlayLabel=computed(()=>detailPlayResume.value?'继续播放':'播放')
const detailEpisodeHeading = computed(() => {
  const { episode, name } = displayed.value
  return episode != null ? `第 ${episode} 集 · ${name}` : ''
})
const detailTechnicalLine=computed(()=>[displayed.value.duration?Math.round(displayed.value.duration/60)+'分钟':'',displayed.value.year,displayed.value.height?displayed.value.height+'p':''].filter(Boolean).join(' · '))
const detailMetaBadges=computed(()=>[displayed.value.sortValues?.officialRating].filter(Boolean))
const detailGenreLine=computed(()=>displayed.value.genres.join(' / ')),currentOverviewText=computed(()=>displayed.value.overview)
const episodeItems=computed(()=>[...(props.episodes||props.children.filter(item=>item.kind==='episode'))]
  .sort((a,b)=>(a.episode??Infinity)-(b.episode??Infinity)))
function primaryArtwork(id:string) {
  return props.account.providerId === 'plex' ? undefined : `Items/${encodeURIComponent(id)}/Images/Primary?maxWidth=400`
}
watch([() => props.item.id, episodeItems], ([id, episodes], previous) => {
  const existing = previous?.[0] === id ? selectedEpisode.value?.id : undefined
  selectedEpisode.value = episodes.find(item => item.id === existing) || episodes[0]
}, { immediate: true })
watch(()=>[displayed.value.id,versions.value] as const,()=>{const existing=getServerPlaybackSource(props.account.id,displayed.value.id);selectedVersion.value=versions.value.find(v=>v.id===existing)?.id||versions.value[0]?.id||'';setServerPlaybackSource(props.account.id,displayed.value.id,selectedVersion.value)},{immediate:true})
const linkError=ref('')
async function openLink(url:string){try{await nativeCall('open_media_link',{url})}catch(cause){linkError.value=(cause as Error).message}}
</script>

<template>
  <MediaDetailPage class="server-media-detail" :item-key="item.id" :title="item.name" :play-label="detailPlayLabel"
    :progress="detailPlayResume?.percent" :play-disabled="busy || !playable"
    :has-version="versions.length > 1" @back="emit('back')" @play="playDetail">
    <template #header-actions>
      <button type="button" class="action-button" title="播放列表" @click="emit('action','playlist',displayed)">
        <ListPlus :size="20" />
      </button>
      <ElectronTrigger>
        <button type="button" class="action-button" title="更多操作">
          <Ellipsis :size="20" />
          <ChevronDown :size="12" />
        </button>
        <template #content>
          <MediaPosterMenu server detail :tv="['series','show','season'].includes(displayed.kind)" :watched="displayed.watched" :favorite="displayed.favorite" @action="emit('action',$event,displayed)"/>
        </template>
      </ElectronTrigger>
    </template>

    <template v-if="detailBackdropUrl" #backdrop>
      <ServerArtwork :account="account" :path="detailBackdropUrl" alt="" class="hero-backdrop">
        <template #fallback>
          <span aria-hidden="true" />
        </template>
      </ServerArtwork>
    </template>

    <template #summary>
      <ServerArtwork v-if="detailLogoUrl" :account="account" :path="detailLogoUrl" :alt="item.name" class="hero-logo">
        <template #fallback>
          <h1 class="hero-title" :title="item.name">{{ item.name }}</h1>
        </template>
      </ServerArtwork>
      <h1 v-else class="hero-title" :title="item.name">{{ item.name }}</h1>
      <div v-if="detailEpisodeHeading" class="hero-episode-title" :title="detailEpisodeHeading">{{ detailEpisodeHeading }}</div>
      <div class="hero-meta-secondary">
        <span v-if="detailTechnicalLine">{{ detailTechnicalLine }}</span>
        <span v-for="badge in detailMetaBadges" :key="badge" class="content-certification">{{ badge }}</span>
        <span v-if="detailGenreLine">{{ detailGenreLine }}</span>
      </div>
      <p v-if="!generalPreferences.hideSpoilers && currentOverviewText" class="hero-overview" :title="currentOverviewText">
        {{ currentOverviewText }}
      </p>
      <div class="hero-meta">
        <MediaSourceRatings :rating="displayed.rating" :critic-rating="displayed.criticRating" :is-movie="item.kind === 'movie'" />
      </div>
    </template>

    <template #versions>
      <ElectronTrigger v-if="versions.length>1">
        <button class="version-button" title="选择视频版本">
          <ChevronDown :size="20"/>
        </button>
        <template #content>
          <div class="server-detail-menu">
            <button v-for="source in versions" :key="source.id" class="detail-version-option" :class="{active:selectedSourceOption?.id===source.id}" @click="selectVersion(source.id)">
              <div class="detail-version-main">
                <span>{{source.title}}</span>
                <small>{{source.fileLabel}}</small>
              </div>
              <span v-if="selectedSourceOption?.id===source.id" class="detail-version-check">当前</span>
            </button>
          </div>
        </template>
      </ElectronTrigger>
    </template>
    <template #actions>
      <div class="action-buttons">
        <button
          class="action-button"
          :class="{ active: detailIsWatched }"
          :title="detailIsWatched ? '标记未观看' : '标记已观看'"
          @click="emit('action','watched',displayed)"
          >
          <component :is="detailIsWatched ? EyeOff : Eye" :size="20" />
        </button>
        <button type="button" class="action-button" title="下载" :disabled="busy" @click="emit('action','download',displayed)"><Download :size="20"/></button>
        <button
          class="action-button"
          :disabled="['season','playlist'].includes(displayed.kind)"
          title="评分"
          @click="emit('action','rating',displayed)"
          >
          <Star :size="20" />
        </button>
        <button
          class="action-button"
          :class="{ active: detailIsFavorite }"
          :title="detailIsFavorite ? '取消收藏' : '收藏'"
          @click="emit('action','favorite',displayed)"
          >
          <Heart :size="20" :fill="detailIsFavorite ? 'currentColor' : 'none'" />
        </button>
        <button class="action-button" title="播放列表" @click="emit('action','playlist',displayed)">
          <ListPlus :size="20" />
        </button>
      </div>
    </template>

    <section v-if="children.length||episodeItems.length" class="episodes-section">
      <div class="season-tabs">
        <button v-for="season in children.filter(item=>item.kind==='season')" :key="season.id" class="tag-item clickable" :aria-pressed="selectedSeasonId === season.id" @click="emit('season',season)">{{season.name}}</button>
      </div>
      <div class="episodes-grid">
        <div v-for="episode in episodeItems" :key="episode.id" class="episode-card" :class="{active:selectedEpisode?.id===episode.id}" role="button" tabindex="0" @click="selectedEpisode=episode" @keydown.enter="selectedEpisode=episode" @contextmenu.prevent="emit('action','menu',episode)">
          <div class="episode-thumbnail"><WatchedIndicator corner :watched="episode.watched"/>
            <ServerArtwork :account="account" :path="episode.backdropPath||episode.imagePath||primaryArtwork(episode.id)" :alt="episode.name"/>
            <button type="button" class="episode-play-overlay" :aria-label="'播放 '+episode.name" @click.stop="emit('play',episode)">
              <Play :size="20" fill="currentColor"/>
            </button>
            <progress v-if="episode.progress" class="detail-episode-progress" :value="episode.progress" max="100" aria-label="播放进度" />
          </div>
          <div class="episode-info">
            <div class="episode-title">{{ episode.episode != null ? `E${episode.episode} · ` : '' }}{{ episode.name }}</div>
          </div>
        </div>
      </div>
    </section>
    <section v-if="item.people?.length" class="cast-section">
      <div class="section-header">
        <h3>演职员</h3>
      </div>
      <div class="cast-list">
        <button v-for="person in item.people" :key="person.id+person.role" class="cast-card" @click="emit('person',person)">
          <div class="cast-avatar">
            <ServerArtwork :account="account" :path="person.imagePath||primaryArtwork(person.id)" :alt="person.name"/>
          </div>
          <div class="cast-name">{{person.name}}</div>
          <div class="cast-role">{{person.role}}</div>
        </button>
      </div>
    </section>
    <section v-if="similar.length" class="episodes-section collection-section">
      <div class="section-header">
        <h3>推荐</h3>
      </div>
      <div class="episodes-grid collection-poster-rail">
        <button v-for="item in similar" :key="item.id" class="episode-card collection-poster-card" @click="emit('select',item)">
          <div class="episode-thumbnail">
            <ServerArtwork :account="account" :path="item.imagePath" :alt="item.name"/>
            <WatchedIndicator corner :watched="item.watched"/>
            <PosterRatingBadge :rating="item.rating" :is-movie="item.kind==='movie'"/>
          </div>
          <div class="episode-info episode-title">{{item.name}}</div>
        </button>
      </div>
    </section>
    <section v-if="item.genres.length||item.studios.length" class="tags-section">
      <div class="tag-list">
        <button v-for="genre in item.genres" :key="genre" class="tag-item clickable" @click="emit('facet','genre',genre)">{{genre}}</button>
        <button v-for="studio in item.studios" :key="studio" class="tag-item clickable" @click="emit('facet','studio',studio)">{{studio}}</button>
      </div>
    </section>
    <section v-if="displayed.externalLinks?.length" class="tags-section server-detail-links">
      <div class="section-header">
        <h3>链接</h3>
      </div>
      <div class="tag-list">
        <a v-for="link in displayed.externalLinks" :key="link.url" class="tag-item clickable" :href="link.url" @click.prevent="openLink(link.url)">
          <span class="detail-link-glyph">↗</span>{{link.title}}</a>
      </div>
      <p v-if="linkError" role="alert">{{linkError}}</p>
    </section>
    <MediaDetailInfo v-if="selectedSourceOption" :cards="streamCards"
      :file="{ source: account.name, path: selectedSourceOption.filePath, name: selectedSourceOption.fileLabel }"
      interactive selectable @select="selectStream" @inspect="mediaInfo = $event" />
    <slot />

    <template #dialogs>
      <ElectronModal v-if="mediaInfo" title="媒体元数据" :width="920" @close="mediaInfo=undefined">
        <div class="detail-media-modal-panel">
          <h3>{{mediaInfo.title}}</h3>
          <div v-for="row in mediaInfo.rows" :key="row.label" class="server-inspection-row">
            <span>{{row.label}}</span>
            <strong>{{row.value}}</strong>
          </div>
        </div>
      </ElectronModal>
    </template>
  </MediaDetailPage>
</template>

<style>
.media-detail .server-detail-links{align-items:center;gap:12px}
.media-detail .server-detail-links .section-header,.media-detail .server-detail-links .tag-list{margin:0}
.server-detail-menu {
  display: grid;
  padding: 6px;
}
.server-detail-menu button {
  padding: 8px 12px;
  text-align: left;
  color: inherit;
  background: transparent;
  border: 0;
  border-radius: 6px;
}
.server-detail-menu button:hover:not(:disabled) { background: var(--secondary); }
.server-detail-menu button:disabled { opacity: .45; }
.server-detail-menu .detail-version-main { display: grid; gap: 2px; }
.server-inspection-row {
  display: grid;
  grid-template-columns: minmax(80px, 1fr) 3fr;
  gap: 12px;
  margin: 8px 0;
}
</style>

<style scoped>.server-media-detail :deep(.action-buttons){grid-auto-columns:minmax(0,1fr)}.server-media-detail :deep(.detail-header-actions .action-button){width:40px;height:40px;flex:0 0 40px}.server-media-detail :deep(.detail-header-actions .electron-trigger .action-button){width:60px;gap:3px}</style>
