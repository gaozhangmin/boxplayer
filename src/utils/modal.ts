import { IAliGetFileModel, IAliShareItem } from '../aliapi/alimodels'
import { useModalStore, usePanFileStore, useSettingStore } from '../store'
import { IServerVerData } from '../aliapi/server'
import { IRawUrl } from './proxyhelper'
import message from './message'
import { checkAndIncrement } from './usageLimit'
import usePanTreeStore from '../pan/pantreestore'
import UploadingDAL from '../transfer/uploadingdal'

export function modalCloseAll() {
  useModalStore().showModal('', {})
}

export function modalUserSpace() {
  useModalStore().showModal('userspace', {})
}

export function modalUserRewardSpace(user_id: string) {
  useModalStore().showModal('userrewardspace', { user_id })
}

export function modalCreatNewFile(encType: string = '') {
  useModalStore().showModal('creatfile', { encType })
}

export function modalCreatNewAlbum() {
  useModalStore().showModal('creatalbum', {})
}

export function modalMoveToAlbum() {
  useModalStore().showModal('movetoalbum', {})
}

export function modalCreatNewDir(dirtype: string, encType: string = '', parentdirid: string = '', callback: any = undefined) {
  useModalStore().showModal('creatdir', { dirtype, encType, parentdirid, callback })
}

export function modalCreatNewShareLink(sharetype: string, driveType: string, filelist: IAliGetFileModel[]) {
  useModalStore().showModal('creatshare', { sharetype, driveType, filelist })
}

export function modalDaoRuShareLink(shareUrl: string = '', sharePwd: string = '') {
  const uc = checkAndIncrement('panHubSave')
  if (!uc.allowed) { message.warning(uc.message!); return }
  useModalStore().showModal('daorushare', { shareUrl, sharePwd })
}

export function modalDaoRuShareLinkMulti() {
  useModalStore().showModal('daorusharemulti', {})
}

export function modalRename(istree: boolean, ismulti: boolean, ispic: boolean) {
  useModalStore().showModal(ismulti ? 'renamemulti' : 'rename', { istree, ispic })
}

export function modalEditShareLink(sharelist: IAliShareItem[]) {
  useModalStore().showModal('editshare', { sharelist })
}

export function modalCloud123PaidShare() {
  useModalStore().showModal('cloud123paidshare', {})
}

export function modalShowShareLink(share_id: string, share_pwd: string, share_token: string, withsave: boolean, file_id_list: string[], save_db: boolean = true) {
  useModalStore().showModal('showshare', { share_id, share_pwd, share_token, withsave, save_db, file_id_list })
}

export function modalSelectPanDir(selecttype: string, selectid: string,
                                  callback: (user_id: string, drive_id: string, selectFile: any) => void,
                                  category?: string,
                                  extFilter?: RegExp,
                                  initialTarget?: { user_id: string; drive_id: string }) {
  useModalStore().showModal('selectpandir', { selecttype, selectid, category, extFilter, callback, ...initialTarget })
}

export function modalSelectVideoQuality(fileInfo: IAliGetFileModel, qualityData: IRawUrl, callback: (quality: string) => void) {
  useModalStore().showModal('selectvideoquality', { fileInfo, qualityData, callback })
}

export function modalShuXing(istree: boolean, ispic: boolean = false) {
  useModalStore().showModal('shuxing', { istree, ispic })
}

export function modalSearchPan(inputsearchType: string[]) {
  useModalStore().showModal('searchpan', { inputsearchType })
}

export function modalDLNAPlayer() {
  useModalStore().showModal('dlna', {})
}

export function modalM3U8Download() {
  useModalStore().showModal('m3u8download', {})
}

export function modalCopyFileTree(filelist: IAliGetFileModel[]) {
  useModalStore().showModal('copyfiletree', { filelist })
}

export function modalArchive(user_id: string, drive_id: string, file_id: string, file_name: string, parent_file_id: string, password: string) {
  useModalStore().showModal('archive', { user_id, drive_id, file_id, file_name, parent_file_id, password })
}

export function modalArchivePassword(user_id: string, drive_id: string, file_id: string, file_name: string, parent_file_id: string, domain_id: string, ext: string) {
  useModalStore().showModal('archivepassword', {
    user_id,
    drive_id,
    file_id,
    file_name,
    parent_file_id,
    domain_id,
    ext
  })
}

export function modalUpload(file_id: string, filelist: string[], ispic: boolean = false, encType: string = '') {
  const panTreeStore = usePanTreeStore()
  const panFileStore = usePanFileStore()
  const settingStore = useSettingStore()
  const driveId = panTreeStore.drive_id || panFileStore.DriveID
  const targetDirId = file_id || panFileStore.DirID || panTreeStore.selectDir.file_id
  UploadingDAL.aUploadLocalFiles(panTreeStore.user_id, driveId, targetDirId, filelist, settingStore.downUploadWhatExist, true, encType)
}

export function modalDownload(istree: boolean) {
  useModalStore().showModal('download', { istree })
}

export function modalCloud123OfflineDownload(offlineForm?: { dirId?: string; dirName?: string }) {
  useModalStore().showModal('cloud123offline', offlineForm ? { offlineForm } : {})
}

export function modalUpdateLog() {
  useModalStore().showModal('showupdatelog', {})
}

export function modalShowPost(msg: string, msgid: string) {
  useModalStore().showModal('showpostmodal', { msg, msgid })
}

export function modalPassword(optType: string, callback?: (success: boolean, inputpassword: string) => void) {
  useModalStore().showModal('showpassword', { optType, callback })
}
