import { defineStore } from 'pinia'
import { GetFocusNext, GetSelectedList, KeyboardSelectOne, MouseSelectOne, SelectAll } from '../utils/selecthelper'
import { IStateUploadTask } from '../utils/dbupload'
import fuzzysort from 'fuzzysort'
import { t } from '../i18n'

type Item = IStateUploadTask

export interface UploadedState {

  ListLoading: boolean

  ListDataRaw: Item[]

  ListDataShow: Item[]

  ListSelected: Set<number>

  ListOrderKey: number

  ListFocusKey: number

  ListSelectKey: number

  ListSearchKey: string

  ListDataCount: number
}

type State = UploadedState
const KEY = 'TaskID'

const useUploadedStore = defineStore('uploaded', {
  state: (): UploadedState => ({
    ListLoading: false,
    ListDataRaw: [],
    ListDataShow: [],
    ListSelected: new Set<number>(),
    ListOrderKey: 0,
    ListFocusKey: 0,
    ListSelectKey: 0,
    ListDataCount: 0,
    ListSearchKey: ''
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
    }
  },

  actions: {

    aLoadListData(list: Item[], count: number) {
      this.ListDataShow = list
      this.ListDataRaw = this.mGetOrder(this.ListOrderKey, list)
      const oldSelected = this.ListSelected
      const newSelected = new Set<number>()
      let key = 0
      for (let i = 0, maxi = list.length; i < maxi; i++) {
        key = list[i][KEY]
        if (oldSelected.has(key)) newSelected.add(key)
      }
      this.$patch({ ListSelected: newSelected, ListFocusKey: 0, ListSelectKey: 0, ListSearchKey: '', ListDataCount: count })
      this.mRefreshListDataShow(true)
    },

    mGetOrder(order: number, list: Item[]) {
      return list
    },

    mRefreshListDataShow(refreshRaw: boolean) {
      if (!refreshRaw) {
        const listDataShow = this.ListDataShow.concat()
        Object.freeze(listDataShow)
        this.ListDataShow = listDataShow
        return
      }
      if (this.ListSearchKey) {
        let searchlist: Item[] = []
        let results = fuzzysort.go(this.ListSearchKey, this.ListDataRaw, {
          threshold: -200000,
          keys: ['TaskName'],
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

      const freezeList = this.ListDataShow
      const oldSelected = this.ListSelected
      const newSelected = new Set<number>()
      let key = 0
      for (let i = 0, maxi = freezeList.length; i < maxi; i++) {
        key = freezeList[i][KEY]
        if (oldSelected.has(key)) newSelected.add(key)
      }
      this.ListSelected = newSelected
    },

    mSearchListData(value: string) {
      this.$patch({ ListSelected: new Set<number>(), ListFocusKey: 0, ListSelectKey: 0, ListSearchKey: value })
      this.mRefreshListDataShow(true)
    },

    mSelectAll() {
      this.$patch({ ListSelected: SelectAll(this.ListDataShow, KEY, this.ListSelected), ListFocusKey: 0, ListSelectKey: 0 })
      this.mRefreshListDataShow(false)
    },

    mMouseSelect(key: number, Ctrl: boolean, Shift: boolean) {
      if (this.ListDataShow.length == 0) return
      const data = MouseSelectOne(this.ListDataShow, KEY, this.ListSelected, this.ListFocusKey, this.ListSelectKey, key, Ctrl, Shift, 0)
      this.$patch({ ListSelected: data.selectedNew, ListFocusKey: data.focusLast, ListSelectKey: data.selectedLast })
      this.mRefreshListDataShow(false)
    },

    mKeyboardSelect(key: number, Ctrl: boolean, Shift: boolean) {
      if (this.ListDataShow.length == 0) return
      const data = KeyboardSelectOne(this.ListDataShow, KEY, this.ListSelected, this.ListFocusKey, this.ListSelectKey, key, Ctrl, Shift, 0)
      this.$patch({ ListSelected: data.selectedNew, ListFocusKey: data.focusLast, ListSelectKey: data.selectedLast })
      this.mRefreshListDataShow(false)
    },

    mRangSelect(lastkey: number, file_idList: number[]) {
      if (this.ListDataShow.length == 0) return
      const selectedNew = new Set<number>(this.ListSelected)
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
      const list = GetSelectedList(this.ListDataShow, KEY, this.ListSelected)
      if (list.length > 0) return list[0]
      return undefined
    },

    mSetFocus(key: number) {
      this.ListFocusKey = key
      this.mRefreshListDataShow(false)
    },

    mGetFocus() {
      if (this.ListFocusKey > 0 && this.ListDataShow.length > 0) return this.ListDataShow[0][KEY]
      return this.ListFocusKey
    },

    mGetFocusNext(position: string) {
      return GetFocusNext<number>(this.ListDataShow, KEY, this.ListFocusKey, position, 0)
    },

    mDeleteFiles(taskidlist: number[]) {
      const fileMap = new Set(taskidlist)
      const listDataRaw = this.ListDataShow
      const newDataList: Item[] = []
      for (let i = 0, maxi = listDataRaw.length; i < maxi; i++) {
        const item = listDataRaw[i]
        if (!fileMap.has(item.TaskID)) {
          newDataList.push(item)
        }
      }
      this.ListDataShow = newDataList
      this.mRefreshListDataShow(true)
    }
  }
})

export default useUploadedStore
