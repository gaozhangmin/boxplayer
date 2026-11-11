import { defineStore } from 'pinia'
import { IPageMusic, IPageMusicTrack } from './appstore'

export interface MusicPlayerState {
  title: string
  artist: string
  album: string
  coverUrl: string
  isPlaying: boolean
  isLoading: boolean
  currentTime: number
  duration: number
  progressPercent: number
  hasTrack: boolean
  volume: number
  mode: 'list' | 'loop-list' | 'loop-one' | 'shuffle'
}

export type MusicPlayerCommand = 'toggle' | 'prev' | 'next' | 'seek' | 'volume' | 'mode' | 'queue'

export default defineStore('musicplayer', {
  state: () => ({
    panelVisible: false,
    commandSeq: 0,
    commandValue: 0,
    command: '' as MusicPlayerCommand | '',
    loadSeq: 0,
    pendingLoad: null as IPageMusic | null,
    nextSeq: 0,
    pendingNext: [] as IPageMusicTrack[],
    state: {
      title: '',
      artist: '',
      album: '',
      coverUrl: '',
      isPlaying: false,
      isLoading: false,
      currentTime: 0,
      duration: 0,
      progressPercent: 0,
      hasTrack: false,
      volume: 1,
      mode: 'loop-list'
    } as MusicPlayerState
  }),
  actions: {
    updateState(state: MusicPlayerState) {
      this.state = state
    },
    sendCommand(command: MusicPlayerCommand, value = 0) {
      this.command = command
      this.commandValue = value
      this.commandSeq += 1
    },
    loadMusic(pageMusic: IPageMusic) {
      this.pendingLoad = pageMusic
      this.loadSeq += 1
    },
    /** Insert tracks right after the current one in the active queue ("Play Next"). */
    queueNext(tracks: IPageMusicTrack[]) {
      this.pendingNext = tracks.slice()
      this.nextSeq += 1
    },
    togglePanel() {
      this.panelVisible = !this.panelVisible
    },
    showPanel() {
      this.panelVisible = true
    },
    hidePanel() {
      this.panelVisible = false
    }
  }
})
