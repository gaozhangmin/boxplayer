<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {nativeCall} from '@/platform/native'
import WatchedIndicator from '../../library/electron/WatchedIndicator.vue'
import PosterRatingBadge from '../../library/electron/PosterRatingBadge.vue'
import ElectronModal from '@/components/dialog/ElectronModal.vue'
import {ListPlus,Ellipsis,ChevronDown,Eye,EyeOff,Star,Heart,Download,Play} from 'lucide-vue-next'
import ServerArtwork from '../ServerArtwork.vue'
import MediaPosterMenu from './MediaPosterMenu.vue'
import MediaSourceRatings from './MediaSourceRatings.vue'
import IconFont from './IconFont.vue'
import ElectronTrigger from './ElectronTrigger.vue'
import ServerListing from './ServerListing.vue'
import type {ServerItem,ServerPerson} from '../workspace'
import type {Account} from '../../sources/contracts'
import {setServerPlaybackSource,getServerPlaybackSource} from '../../sources/serverVersions'
import {generalPreferences} from '../../library/displayPreferences'
const props=defineProps<{item:ServerItem;account:Account;children:ServerItem[];episodes?:ServerItem[];selectedSeasonId?:string;similar:ServerItem[];busy?:boolean;menuEntries:{id:string;label:string;disabled?:boolean}[]}>()
const emit=defineEmits<{back:[];play:[item:ServerItem];action:[action:string,item:ServerItem];select:[item:ServerItem];person:[person:ServerPerson];facet:[kind:'genre'|'studio',value:string];season:[item:ServerItem]}>()
const mediaInfo=ref<import('../workspace').MediaInfoCard>()
const selectedEpisode=ref<ServerItem>(),selectedVersion=ref('')
const versions=computed(()=>displayed.value.versions||[])
const selectedSourceOption=computed(()=>versions.value.find(v=>v.id===selectedVersion.value)||versions.value[0])
function selectVersion(id:string){selectedVersion.value=id;setServerPlaybackSource(props.account.id,displayed.value.id,id)}
watch(()=>props.item.id,()=>{selectedEpisode.value=undefined;selectedVersion.value=''})
const displayed=computed(()=>selectedEpisode.value||props.item),currentDetail=computed(()=>props.item),detailDisplayedItem=displayed
const detailBackdropUrl=computed(()=>props.item.backdropPath),detailBackdropLoadFailed=ref(false),detailLogoUrl=computed(()=>props.item.logoPath)
const currentBackLabel='返回',detailIsWatched=computed(()=>displayed.value.watched),detailIsFavorite=computed(()=>displayed.value.favorite)
const playable=computed(()=>displayed.value.playable||props.children.some(i=>i.playable)||props.children.some(i=>['season','show','series'].includes(i.kind)))
const detailPlayResume=computed(()=>displayed.value.progress?{percent:displayed.value.progress}:undefined)
const detailPlayLabel=computed(()=>detailPlayResume.value?'继续播放':'播放')
const detailEpisodeHeading=computed(()=>displayed.value.episode!=null?'第 '+displayed.value.episode+' 集':'')
const detailTechnicalLine=computed(()=>[displayed.value.duration?Math.round(displayed.value.duration/60)+'分钟':'',displayed.value.year,displayed.value.height?displayed.value.height+'p':''].filter(Boolean).join(' · '))
const detailMetaBadges=computed(()=>[displayed.value.sortValues?.officialRating].filter(Boolean))
const detailGenreLine=computed(()=>displayed.value.genres.join(' / ')),currentOverviewText=computed(()=>displayed.value.overview)
const episodeItems=computed(()=>props.episodes||props.children.filter(item=>item.kind==='episode'))
watch(episodeItems,episodes=>{if(episodes.length)selectedEpisode.value=episodes.find(item=>item.id===selectedEpisode.value?.id)||episodes[0]},{immediate:true})
watch(()=>[displayed.value.id,versions.value] as const,()=>{const existing=getServerPlaybackSource(props.account.id,displayed.value.id);selectedVersion.value=versions.value.find(v=>v.id===existing)?.id||versions.value[0]?.id||'';setServerPlaybackSource(props.account.id,displayed.value.id,selectedVersion.value)},{immediate:true})
const linkError=ref('')
async function openLink(url:string){try{await nativeCall('open_media_link',{url})}catch(cause){linkError.value=(cause as Error).message}}
function handleBack(){emit('back')}
function t(key:string){return {'mediaServer.noOverview':'暂无简介','mediaServer.current':'当前'}[key]||key}
</script>
<template><div class="media-server-workspace"><div class="workspace-page workspace-page-detail"><div class="workspace-content workspace-content-detail"><div class="detail-page">              <div class="detail-shell">
                <ServerArtwork v-if="detailBackdropUrl"
                  class="detail-page-backdrop"
                  :account="account" :path="detailBackdropUrl"
                  :alt="currentDetail.name"
                  aria-hidden="true" />
                <div class="detail-page-tint" aria-hidden="true" />
                <div class="detail-backdrop-stage">
                  <ServerArtwork v-if="detailBackdropUrl"
                    class="detail-backdrop-image"
                    :account="account" :path="detailBackdropUrl"
                    :alt="currentDetail.name"
                     />
                  <div v-else class="detail-backdrop-fallback" />
                  <div class="detail-backdrop-mask" />
                  <div class="detail-backdrop-bottom-haze" />

                  <div class="detail-top-back">
                    <button type="button" class="detail-back-button" @click="handleBack">
                      <IconFont name="iconarrow-left-2-icon" />
                      <span>{{ currentBackLabel }}</span>
                    </button>
                    <div class="detail-top-actions">
                      <button type="button" class="detail-top-icon-action" title="播放列表" @click="emit('action','playlist',displayed)"><ListPlus :size="20" /></button>
                      <ElectronTrigger trigger="click" position="br">
                        <button type="button" class="detail-top-icon-action" title="更多操作"><Ellipsis :size="20" /><ChevronDown :size="12" /></button>
                        <template #content><MediaPosterMenu server detail :tv="['series','show','season'].includes(displayed.kind)" :watched="displayed.watched" :favorite="displayed.favorite" @action="emit('action',$event,displayed)"/></template>
                      </ElectronTrigger>
                    </div>
                  </div>

                  <div class="detail-hero-copy">
                    <div class="detail-overlay-grid">
                      <div class="detail-hero-controls">
                        <div v-if="detailLogoUrl" class="detail-title-block detail-title-block-brand">
                          <ServerArtwork :account="account"
                            class="detail-hero-logo"
                            :path="detailLogoUrl"
                            :alt="currentDetail.name"
                            
                          />
                        </div>
                        <div v-else class="detail-title-block">
                          <h1 class="detail-hero-title">{{ currentDetail.name }}</h1>
                        </div>

                        <div class="detail-actions-column">
                          <div class="detail-play-row" :class="{ 'has-version': versions.length>1 }">
                            <button :disabled="busy||!playable" class="detail-primary-play" :class="{ 'has-resume': detailPlayResume }" @click="emit('play',displayed)">
                              <span v-if="detailPlayResume" class="detail-play-progress" aria-hidden="true" :style="{ width: `${detailPlayResume.percent}%` }"></span>
                              <span class="detail-play-label">{{ detailPlayLabel }}</span>
                            </button>
                            <ElectronTrigger v-if="versions.length>1"><button class="detail-play-version-trigger" title="选择视频版本"><ChevronDown :size="20"/></button><template #content><div class="detail-version-menu"><button v-for="source in versions" :key="source.id" class="detail-version-option" :class="{active:selectedSourceOption?.id===source.id}" @click="selectVersion(source.id)"><div class="detail-version-main"><span>{{source.title}}</span><small>{{source.fileLabel}}</small></div><span v-if="selectedSourceOption?.id===source.id" class="detail-version-check">当前</span></button></div></template></ElectronTrigger>
                          </div>
                          <div class="detail-icon-actions">
                            <button
                              class="detail-square-action"
                              :class="{ active: detailIsWatched }"
                              :title="detailIsWatched ? '标记未观看' : '标记已观看'"
                              @click="emit('action','watched',displayed)"
                            >
                              <component :is="detailIsWatched ? EyeOff : Eye" :size="20" />
                            </button>
                            <ElectronTrigger v-if="['show','series','season'].includes(item.kind)"><button class="detail-square-action" title="下载"><Download :size="20"/></button><template #content><div class="detail-version-menu"><button class="detail-version-option" :disabled="!displayed.playable" @click="emit('action','download',displayed)">下载当前集</button><button class="detail-version-option" @click="emit('action','download-season',displayed)">{{item.kind==='season'?'下载本季':'下载当前季'}}</button><button v-if="item.kind!=='season'" class="detail-version-option" @click="emit('action','download-series',displayed)">下载整部剧集</button></div></template></ElectronTrigger><button v-else class="detail-square-action" title="下载" :disabled="!displayed.playable" @click="emit('action','download',displayed)"><Download :size="20"/></button>
                            <button
                              class="detail-square-action"
                              :disabled="['season','playlist'].includes(displayed.kind)"
                              title="评分"
                              @click="emit('action','rating',displayed)"
                            ><Star :size="20" /></button>
                            <button
                              class="detail-square-action"
                              :class="{ active: detailIsFavorite }"
                              :title="detailIsFavorite ? '取消收藏' : '收藏'"
                              @click="emit('action','favorite',displayed)"
                            >
                              <Heart :size="20" :fill="detailIsFavorite ? 'currentColor' : 'none'" />
                            </button>
                            <button class="detail-square-action" title="播放列表" @click="emit('action','playlist',displayed)"><ListPlus :size="20" /></button>
                          </div>
                        </div>
                      </div>

                      <div class="detail-hero-main">
                        <div class="detail-synopsis-column">
                          <div class="detail-episode-heading">
                            <span v-if="detailEpisodeHeading">{{ detailEpisodeHeading }} · </span>{{ detailDisplayedItem.name || currentDetail.name }}
                          </div>
                          <div class="detail-facts-line">
                            <span v-if="detailTechnicalLine">{{ detailTechnicalLine }}</span>
                            <span v-for="badge in detailMetaBadges" :key="badge" class="detail-meta-badge">{{ badge }}</span>
                            <span v-if="detailGenreLine">{{ detailGenreLine }}</span>
                          </div>
                          <div v-if="!generalPreferences.hideSpoilers" class="detail-overview-block" :class="{ 'is-empty': !currentOverviewText }">
                            <p
                              class="detail-overview"
                              :class="{ 'is-empty': !currentOverviewText }"
                              :title="currentOverviewText || t('mediaServer.noOverview')"
                            >
                              {{ currentOverviewText || t('mediaServer.noOverview') }}
                            </p>
                          </div>
                          <MediaSourceRatings
                            class="detail-score-row"
                            :is-movie="currentDetail?.kind === 'movie'"
                            :rating="detailDisplayedItem.rating"
                            :critic-rating="detailDisplayedItem.criticRating"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

<div class="detail-lower-content">
<section v-if="children.length||episodeItems.length" class="detail-section detail-section-episodes"><div class="detail-season-picker"><button v-for="season in children.filter(item=>item.kind==='season')" :key="season.id" class="detail-chip-button" :class="{active:selectedSeasonId===season.id}" @click="emit('season',season)">{{season.name}}</button></div><div class="detail-episodes-rail"><div v-for="(episode,index) in episodeItems" :key="episode.id" class="detail-episode-card" :class="{selected:selectedEpisode?.id===episode.id}" role="button" tabindex="0" @click="selectedEpisode=episode" @keydown.enter="selectedEpisode=episode" @contextmenu.prevent="emit('action','menu',episode)"><div class="detail-episode-cover media-image-frame"><ServerArtwork :account="account" :path="episode.backdropPath||episode.imagePath" :alt="episode.name"/><button type="button" class="detail-episode-play-overlay" :aria-label="'播放 '+episode.name" @click.stop="emit('play',episode)"><Play :size="20" fill="currentColor"/></button><div v-if="episode.progress" class="detail-episode-progress"><div class="detail-episode-progress-bar" :style="{width:Math.min(100,episode.progress)+'%'}"/></div></div><div class="detail-episode-caption"><span class="detail-episode-index">{{index+1}}.</span><span class="detail-episode-kicker">{{episode.season!=null?'S'+episode.season:''}}{{episode.episode!=null?' E'+episode.episode:''}}</span><span class="detail-episode-title">{{episode.name}}</span></div></div></div></section>
<section v-if="item.people?.length" class="detail-section detail-section-people"><div class="detail-section-header"><h4>演职员</h4></div><div class="people-rail detail-people-rail"><button v-for="person in item.people" :key="person.id+person.role" class="person-card person-card-rail person-card-button" @click="emit('person',person)"><div class="person-avatar media-image-frame"><ServerArtwork :account="account" :path="person.imagePath" :alt="person.name"/></div><div class="person-name">{{person.name}}</div><div class="person-role">{{person.role}}</div></button></div></section>
<section v-if="similar.length" class="detail-section detail-section-similar"><div class="detail-section-header"><h4>推荐</h4></div><div class="detail-recommendation-rail"><button v-for="item in similar" :key="item.id" class="detail-recommendation-card" @click="emit('select',item)"><div class="detail-recommendation-poster media-image-frame"><ServerArtwork :account="account" :path="item.imagePath" :alt="item.name"/><WatchedIndicator corner :watched="item.watched"/><PosterRatingBadge :rating="item.rating" :is-movie="item.kind==='movie'"/></div><div class="detail-recommendation-title">{{item.name}}</div></button></div></section>
<section v-if="item.genres.length||item.studios.length" class="detail-section"><div class="detail-chip-row"><button v-for="genre in item.genres" :key="genre" class="detail-chip-button" @click="emit('facet','genre',genre)">{{genre}}</button><button v-for="studio in item.studios" :key="studio" class="detail-chip-button" @click="emit('facet','studio',studio)">{{studio}}</button></div></section>
<section v-if="displayed.externalLinks?.length" class="detail-section detail-section-links"><div class="detail-section-header"><h4>链接</h4></div><div class="detail-chip-row"><a v-for="link in displayed.externalLinks" :key="link.url" class="detail-chip-link" :href="link.url" @click.prevent="openLink(link.url)"><span class="detail-link-glyph">↗</span>{{link.title}}</a></div><p v-if="linkError" role="alert">{{linkError}}</p></section>
<section v-if="selectedSourceOption" class="detail-section detail-section-media"><div class="detail-section-header"><h4>媒体</h4></div><div class="detail-file-bar"><div class="detail-file-source">在 {{account.name}} 上</div><div v-if="selectedSourceOption.filePath" class="detail-file-path">路径：{{selectedSourceOption.filePath}}</div><div class="detail-file-name">{{selectedSourceOption.fileLabel}}</div></div><div class="detail-media-card-rail"><div v-for="card in selectedSourceOption.mediaInfoCards" :key="card.id" class="detail-media-card" role="button" tabindex="0" @click="mediaInfo=card" @keydown.enter="mediaInfo=card"><div class="detail-media-card-title"><span class="detail-media-kind-badge">{{card.kind==='video'?'影':card.kind==='audio'?'声':'字'}}</span>{{card.title}}</div><div class="detail-media-card-body"><div v-for="row in card.rows" :key="row.label" class="detail-media-row"><span>{{row.label}}</span><strong>{{row.value}}</strong></div></div></div></div></section></div></div></div></div></div></div><ElectronModal v-if="mediaInfo" title="媒体元数据" :width="920" @close="mediaInfo=undefined"><div class="detail-media-modal-panel"><h3>{{mediaInfo.title}}</h3><div v-for="row in mediaInfo.rows" :key="row.label" class="detail-media-row"><span>{{row.label}}</span><strong>{{row.value}}</strong></div></div></ElectronModal></template>
<style scoped src="./workspace.css"></style><style src="./workspace-overrides.css"></style>
<style scoped>.detail-menu-action{display:block;width:100%;padding:7px 12px;text-align:left}.detail-menu-action:hover{background:var(--secondary)}.detail-cast-avatar{width:120px;height:160px;overflow:hidden;border-radius:12px}.detail-primary-play:disabled{opacity:.5}</style>
<style scoped>.media-server-workspace .detail-primary-play{background:var(--primary)!important;border-color:var(--primary)!important;box-shadow:none!important}.detail-hero-logo{object-fit:contain}</style>
