import fuzzysort from 'fuzzysort'
import { defineStore } from 'pinia'
import DownDAL, { IStateDownFile } from './DownDAL'
import { GetFocusNext, GetSelectedList, KeyboardSelectOne, MouseSelectOne, SelectAll } from '../utils/selecthelper'
import { humanSize } from '../utils/format'
import message from '../utils/message'
import DBDown from '../utils/dbdown'
import { batchPauseTasks, batchRemoveTasks, batchResumeTasks } from './integration/aria2TaskApi'
import { t } from '../i18n'

type Item = IStateDownFile
type State = DowningState
const KEY = 'DownID'

export interface DowningState {

  ListLoading: boolean

  ListDataRaw: Item[]

  ListDataShow: Item[]

  ListSelected: Set<string>

  ListOrderKey: string

  ListFocusKey: string

  ListSelectKey: string

  ListSearchKey: string
}

const useDowningStore = defineStore('downing', {
  state: (): State => ({
    ListLoading: false,
    ListDataRaw: [],
    ListDataShow: [],
    ListSelected: new Set<string>(),
    ListOrderKey: 'DownID',
    ListFocusKey: '',
    ListSelectKey: '',
    ListSearchKey: ''
  }),

  getters: {
    ListDataCount(state: State): number {
      return state.ListDataShow.length
    },

    ListDataDowningCount(state: State): number {
      return state.ListDataRaw.filter((down: any) => down.Down.IsDowning).length
    },

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

    aLoadListData(list: Item[]) {
      this.ListDataRaw = this.mGetOrder(this.ListOrderKey, list)
      let oldSelected = this.ListSelected
      let newSelected = new Set<string>()
      let key = ''
      for (let i = 0, maxi = list.length; i < maxi; i++) {
        key = list[i][KEY]
        if (oldSelected.has(key)) newSelected.add(key)
      }
      this.$patch({ ListSelected: newSelected, ListFocusKey: '', ListSelectKey: '', ListSearchKey: '' })
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

    mDeleteFiles(shareidlist: string[]) {
      let filemap = new Set(shareidlist)
      let ListDataRaw = this.ListDataRaw
      let NewDataList: Item[] = []
      for (let i = 0, maxi = ListDataRaw.length; i < maxi; i++) {
        let item = ListDataRaw[i]
        if (!filemap.has(item[KEY])) {
          NewDataList.push(item)
        }
      }
      if (this.ListDataRaw.length != NewDataList.length) {
        this.ListDataRaw = NewDataList
        this.mRefreshListDataShow(true)
      }
    },

    mAddDownload({ downlist }: { downlist: Item[] }) {
      const savelist = []
      const DowningList = this.ListDataRaw
      const haslist = new Set(DowningList.map(item => item.DownID))
      for (const downitem of downlist) {
        if (!haslist.has(downitem.DownID)) {
          savelist.push(downitem)
          haslist.add(downitem.DownID)
        }
      }
      if (savelist.length === 0) {
        message.info(t('transfer.taskAlreadyExists'))
      } else {
        DBDown.saveDownings(JSON.parse(JSON.stringify(savelist)))
        DowningList.push(...savelist)
        this.mRefreshListDataShow(true)
      }
    },

    /**
     * 开始下载，只改变状态，待定时任务处理
     */
    async mStartDowning() {
      const gids: string[] = []
      const DowningList = this.ListDataRaw
      for (const downID of this.ListSelected) {
        const selectedDown: IStateDownFile | undefined = DowningList.find(down => down.DownID === downID)
        if (selectedDown?.Info.offlineProvider) continue
        if (selectedDown && !selectedDown.Down.IsDowning && !selectedDown.Down.IsCompleted) {
          if (selectedDown.Down.IsStop && selectedDown.Info.GID) gids.push(selectedDown.Info.GID)
          this.mUpdateDownState(selectedDown, 'queue')
        }
      }
      if (gids.length) await batchResumeTasks(gids)
    },

    /**
     * 开始全部
     */
    async mStartAllDowning() {
      const gids: string[] = []
      const DowningList = this.ListDataRaw
      for (let j = 0; j < DowningList.length; j++) {
        const down = DowningList[j].Down
        if (DowningList[j].Info.offlineProvider) continue
        if (down.IsDowning || down.IsCompleted) continue
        if (down.IsStop && DowningList[j].Info.GID) gids.push(DowningList[j].Info.GID)
        this.mUpdateDownState(DowningList[j], 'queue')
      }
      if (gids.length) await batchResumeTasks(gids)
    },

    /**
     * 暂停下载，只改变状态，待定时任务处理
     */
    async mStopDowning() {
      const gidList: string[] = []
      const downList: Item[] = []
      const DowningList = this.ListDataRaw
      for (const DownID of this.ListSelected) {
        for (let j = 0; j < DowningList.length; j++) {
          if (DowningList[j].DownID == DownID) {
            const down = DowningList[j].Down
            if (down.IsCompleted) continue
            if (!DowningList[j].Info.offlineProvider) {
              gidList.push(DowningList[j].Info.GID)
              downList.push(DowningList[j])
              this.mUpdateDownState(DowningList[j], 'stop')
            }
            break
          }
        }
      }
      await DownDAL.stopDowning(downList, gidList)
      this.mRefreshListDataShow(true)
    },

    /**
     * 暂停全部
     */
    async mStopAllDowning() {
      const gidList: string[] = []
      const DowningList = this.ListDataRaw
      for (let j = 0; j < DowningList.length; j++) {
        const down = DowningList[j].Down
        if (down.IsCompleted) continue
        if (!DowningList[j].Info.offlineProvider) {
          gidList.push(DowningList[j].Info.GID)
          this.mUpdateDownState(DowningList[j], 'stop')
        }
      }
      await DownDAL.stopDowning(DowningList, gidList)
      this.mRefreshListDataShow(true)
    },

    /**
     * 删除下载，修改为“待删除”状态，并从列表中删除 <br/>
     * 注：下载服务中的执行列表，请根据状态做进一步处理
     * @param downIDList
     */
    async mDeleteDowning(downIDList: string[]) {
      const gidList: string[] = []
      const newListSelected = new Set(this.ListSelected)
      const newList: Item[] = []
      const DowningList: Item[] = this.ListDataRaw
      const deleteList: Item[] = []
      for (let j = 0; j < DowningList.length; j++) {
        const DownID = DowningList[j].DownID
        if (downIDList.includes(DownID)) {
          DowningList[j].Down.DownState = '待删除'
          if (!DowningList[j].Info.offlineProvider) {
            gidList.push(DowningList[j].Info.GID)
          }
          deleteList.push(DowningList[j])
          if (newListSelected.has(DownID)) {
            newListSelected.delete(DownID)
          }
        } else {
          newList.push(DowningList[j])
        }
      }
      this.ListDataRaw = newList
      this.ListSelected = newListSelected
      await DownDAL.deleteDowning(false, deleteList, gidList)
      this.mRefreshListDataShow(true)
    },

    /**
     * 删除全部，修改为“待删除”状态，并从列表中删除 <br/>
     * 注：下载服务中的执行列表，请根据状态做进一步处理
     */
    async mDeleteAllDowning() {
      const gidList: string[] = []
      const DowningList = this.ListDataRaw
      for (let j = 0; j < DowningList.length; j++) {
        DowningList[j].Down.DownState = '待删除'
        if (!DowningList[j].Info.offlineProvider) {
          gidList.push(DowningList[j].Info.GID)
        }
      }
      await DownDAL.deleteDowning(true, DowningList, gidList)
      DowningList.splice(0, DowningList.length)
      this.ListSelected = new Set<string>()
      this.mRefreshListDataShow(true)
    },

    /**
     * 排序
     * @param downIDList 要放在前面的上传ID
     */
    mOrderDowning(downIDList: string[]) {
      const DowningList = this.ListDataRaw
      const newlist: Item[] = []
      const lastlist: Item[] = []

      for (let j = 0; j < DowningList.length; j++) {
        const DownID = DowningList[j].DownID
        let find = false
        for (let i = 0; i < downIDList.length; i++) {
          if (downIDList[i] == DownID) {
            newlist.push(DowningList[j])
            find = true
            break
          }
        }
        if (!find) {
          lastlist.push(DowningList[j])
        }
      }
      DowningList.splice(0, DowningList.length, ...newlist, ...lastlist)
      this.mRefreshListDataShow(true)
    },

    mUpdateDownState(DownItem: IStateDownFile, state: string, msg?: string) {
      const { DownID, Down } = DownItem
      const updateState: any = {
        DownID: DownID,
        IsDowning: false,
        IsCompleted: false,
        DownProcess: 0,
        DownSpeedStr: '',
        DownState: '',
        AutoTry: 0,
        IsFailed: false,
        IsStop: false,
        FailedCode: 0,
        FailedMessage: ''
      }
      switch (state) {
        case 'start':
          updateState.DownState = '解析中'
          updateState.IsDowning = true
          updateState.DownTime = Date.now()
          break
        case 'queue':
          updateState.IsDowning = false
          updateState.DownState = '队列中'
          break
        case 'success':
          updateState.IsDowning = true
          updateState.DownState = '下载中'
          break
        case 'downed':
          updateState.IsDowning = true
          updateState.IsCompleted = true
          updateState.DownState = '已完成'
          updateState.DownProcess = 100
          break
        case 'valid':
          updateState.IsDowning = true
          updateState.IsCompleted = true
          updateState.DownState = '校验中'
          updateState.DownProcess = 100
          break
        case 'stop':
          updateState.IsDowning = false
          updateState.DownState = '已暂停'
          updateState.DownSpeed = 0
          updateState.DownSpeedStr = ''
          updateState.IsStop = true
          break
        case 'error':
          updateState.DownState = '已出错'
          updateState.DownSpeed = 0
          updateState.AutoTry = Date.now()
          updateState.IsFailed = true
          updateState.FailedMessage = msg || state
          break
        default:
          updateState.DownState = '已出错'
          updateState.DownSpeed = 0
          updateState.AutoTry = Date.now()
          updateState.IsFailed = true
          updateState.FailedCode = 504
          updateState.FailedMessage = msg || state
          break
      }
      DownItem.Down = {  ...DownItem.Down, ...updateState }
    },

    async batchPauseSelected(): Promise<void> {
      const gids: string[] = []
      for (const downID of this.ListSelected) {
        const item = this.ListDataRaw.find((d) => d.DownID === downID)
        if (item && item.Info.GID && !item.Down.IsCompleted && !item.Info.offlineProvider) {
          gids.push(item.Info.GID)
          this.mUpdateDownState(item, 'stop')
        }
      }
      if (gids.length) await batchPauseTasks(gids)
      this.mRefreshListDataShow(true)
    },

    async batchResumeSelected(): Promise<void> {
      const gids: string[] = []
      for (const downID of this.ListSelected) {
        const item = this.ListDataRaw.find((d) => d.DownID === downID)
        if (item && item.Info.GID && !item.Down.IsCompleted && !item.Info.offlineProvider) {
          gids.push(item.Info.GID)
          this.mUpdateDownState(item, 'queue')
        }
      }
      if (gids.length) await batchResumeTasks(gids)
      this.mRefreshListDataShow(true)
    },

    async batchRemoveSelected(): Promise<void> {
      const gids: string[] = []
      const downIDs: string[] = [...this.ListSelected]
      for (const downID of downIDs) {
        const item = this.ListDataRaw.find((d) => d.DownID === downID)
        if (item && item.Info.GID && !item.Info.offlineProvider) gids.push(item.Info.GID)
      }
      if (gids.length) await batchRemoveTasks(gids)
      await this.mDeleteDowning(downIDs)
    }
  }
})

export default useDowningStore
