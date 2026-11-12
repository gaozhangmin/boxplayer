import { Modal } from '@arco-design/web-vue'
import { h } from 'vue'
import fuzzysort from 'fuzzysort'
import { defineStore } from 'pinia'
import type {IStateDownFile} from './downloadTaskModels'
import {completedDownloadActions} from '../../completedDownloadActions'
import { GetFocusNext, GetSelectedList, KeyboardSelectOne, MouseSelectOne, SelectAll } from '@/features/files/electron/selecthelper'
import { humanSize } from '../utils/format'
import { t } from '@/features/files/electron/i18n'

type Item = IStateDownFile
type State = DownState
const KEY = 'DownID'

export interface DownState {

  ListLoading: boolean

  ListDataRaw: Item[]

  ListDataShow: Item[]

  ListSelected: Set<string>

  ListOrderKey: string

  ListFocusKey: string

  ListSelectKey: string

  ListSearchKey: string

  ListDataCount: number
}

const useDownStore = defineStore('source-drive-downed', {
  state: (): State => ({
    ListLoading: false,
    ListDataRaw: [],
    ListDataShow: [],
    ListSelected: new Set<string>(),
    ListOrderKey: 'DownID',
    ListFocusKey: '',
    ListSelectKey: '',
    ListSearchKey: '',
    ListDataCount: 0
  }),

  getters: {

    IsListSelected(state: State): boolean {
      return state.ListSelected.size > 0
    },

    ListSelectedCount(state: State): number {
      return state.ListSelected.size
    },

    ListDataSelectCountInfo(state: State): string {
      return t('transfer.selectedCount', { selected: state.ListSelected.size, total: state.ListDataShow.length })
    },

    IsListSelectedAll(state: State): boolean {
      return state.ListSelected.size > 0 && state.ListSelected.size == state.ListDataShow.length
    },

    ListStats(state: State) {
      let stats = { count: 0, runningCount: 0, totalSize: 0, totalSizeStr: '' }
      let list = state.ListDataShow
      let item: Item
      for (let i = 0, maxi = list.length; i < maxi; i++) {
        item = list[i]
        stats.count++
        stats.totalSize += item.Info.size
        if (item.Down.IsDowning) stats.runningCount++
      }
      stats.totalSizeStr = humanSize(stats.totalSize)
      return stats
    }
  },

  actions: {
    aLoadListData(list: Item[], count: number) {
      this.ListDataRaw = this.mGetOrder(this.ListOrderKey, list)
      let oldSelected = this.ListSelected
      let newSelected = new Set<string>()
      let key = ''
      for (let i = 0, maxi = list.length; i < maxi; i++) {
        key = list[i][KEY]
        if (oldSelected.has(key)) newSelected.add(key)
      }
      this.$patch({
        ListSelected: newSelected,
        ListFocusKey: '',
        ListSelectKey: '',
        ListSearchKey: '',
        ListDataCount: count
      })
      this.mRefreshListDataShow(true)
    },

    mSearchListData(value: string) {
      this.$patch({ ListSelected: new Set<string>(), ListFocusKey: '', ListSelectKey: '', ListSearchKey: value })
      this.mRefreshListDataShow(true)
    },

    mOrderListData(value: string) {
      this.$patch({ ListOrderKey: value, ListSelected: new Set<string>(), ListFocusKey: '', ListSelectKey: '' })
      this.ListDataRaw = this.mGetOrder(value, this.ListDataRaw)
      this.mRefreshListDataShow(true)
    },

    mGetOrder(order: string, list: Item[]) {
      return list
    },

    /**
     * 刷新显示的列表数据
     * @param refreshRaw 是否从原始数据中刷新显示
     */
    mRefreshListDataShow(refreshRaw: boolean) {
      if (!refreshRaw) {
        let ListDataShow = this.ListDataShow.concat()
        Object.freeze(ListDataShow)
        this.ListDataShow = ListDataShow
        return
      }
      if (this.ListSearchKey) {
        let searchlist: Item[] = []
        let results = fuzzysort.go(this.ListSearchKey, this.ListDataRaw, {
          threshold: -200000,
          keys: ['Info.name'],
          scoreFn: (a) => Math.max(a[0] ? a[0].score : -200000, a[1] ? a[1].score : -200000)
        })
        for (let i = 0, maxi = results.length; i < maxi; i++) {
          if (results[i].score > -200000) searchlist.push(results[i].obj as Item)
        }
        Object.freeze(searchlist)
        this.ListDataShow = searchlist
      } else {
        let ListDataShow = this.ListDataRaw.concat()
        Object.freeze(ListDataShow)
        this.ListDataShow = ListDataShow
      }

      let freezelist = this.ListDataShow
      let oldSelected = this.ListSelected
      let newSelected = new Set<string>()
      let key = ''
      for (let i = 0, maxi = freezelist.length; i < maxi; i++) {
        key = freezelist[i][KEY]
        if (oldSelected.has(key)) newSelected.add(key)
      }
      this.ListSelected = newSelected
    },

    mSelectAll() {
      this.$patch({
        ListSelected: SelectAll(this.ListDataShow, KEY, this.ListSelected),
        ListFocusKey: '',
        ListSelectKey: ''
      })
      this.mRefreshListDataShow(false)
    },

    mMouseSelect(key: string, Ctrl: boolean, Shift: boolean) {
      if (this.ListDataShow.length == 0) return
      const data = MouseSelectOne(this.ListDataShow, KEY, this.ListSelected, this.ListFocusKey, this.ListSelectKey, key, Ctrl, Shift, '')
      this.$patch({ ListSelected: data.selectedNew, ListFocusKey: data.focusLast, ListSelectKey: data.selectedLast })
      this.mRefreshListDataShow(false)
    },

    mKeyboardSelect(key: string, Ctrl: boolean, Shift: boolean) {
      if (this.ListDataShow.length == 0) return
      const data = KeyboardSelectOne(this.ListDataShow, KEY, this.ListSelected, this.ListFocusKey, this.ListSelectKey, key, Ctrl, Shift, '')
      this.$patch({ ListSelected: data.selectedNew, ListFocusKey: data.focusLast, ListSelectKey: data.selectedLast })
      this.mRefreshListDataShow(false)
    },

    mRangSelect(lastkey: string, file_idList: string[]) {
      if (this.ListDataShow.length == 0) return
      const selectedNew = new Set<string>(this.ListSelected)
      for (let i = 0, maxi = file_idList.length; i < maxi; i++) {
        selectedNew.add(file_idList[i])
      }
      this.$patch({ ListSelected: selectedNew, ListFocusKey: lastkey, ListSelectKey: lastkey })
      this.mRefreshListDataShow(false)
    },

    GetSelected() {
      return GetSelectedList(this.ListDataShow, KEY, this.ListSelected)
    },

    GetSelectedFirst() {
      let list = GetSelectedList(this.ListDataShow, KEY, this.ListSelected)
      if (list.length > 0) return list[0]
      return undefined
    },

    mSetFocus(key: string) {
      this.ListFocusKey = key
      this.mRefreshListDataShow(false)
    },

    mGetFocus() {
      if (this.ListFocusKey == '' && this.ListDataShow.length > 0) return this.ListDataShow[0][KEY]
      return this.ListFocusKey
    },

    mGetFocusNext(position: string) {
      return GetFocusNext(this.ListDataShow, KEY, this.ListFocusKey, position, '')
    },

    /**
     * 删除下载完成，修改为“待删除”状态，并从列表中删除 <br/>
     * @param downedIDList
     */
    async mDeleteDowned(downedIDList: string[]) {
      const selected = this.ListDataRaw.filter(item => downedIDList.includes(item.DownID))
      if (!selected.length) return
      let removeFiles = false
      const confirmed = await new Promise<boolean>(resolve => {
        Modal.confirm({
          title: '删除已完成下载',
          content: () => h('div', [
            h('p', '默认仅移除下载记录。勾选后将永久删除本地文件，无法撤销。'),
            h('label', [h('input', { type: 'checkbox', onChange: (e: Event) => { removeFiles = (e.target as HTMLInputElement).checked } }), ' 同时从本地彻底移除文件'])
          ]),
          onOk: () => resolve(true), onCancel: () => resolve(false)
        })
      })
      if (!confirmed) return
      await completedDownloadActions(this).remove(selected.map(item => item.DownID),removeFiles)
    },

    async mDeleteAllDowned() {
      await this.mDeleteDowned(this.ListDataRaw.map(item => item.DownID))
    },

    /**
     * 打开下载完成的文件 <br/>
     * file 和 downIDList 二选一
     * @param file
     * @param downIDList
     * @param isDir 是否打开目录
     */
    mOpenUploadedFile(file: Item | null, downIDList: string[], isDir: boolean) {
      return completedDownloadActions(this).open(file ? [file.DownID] : downIDList,isDir)
    }

  }
})

export default useDownStore
