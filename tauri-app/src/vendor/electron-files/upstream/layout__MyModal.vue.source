<script lang='ts'>
import { defineComponent } from 'vue'
import { useModalStore } from '../store'
import UserSpaceModal from '../user/UserSpaceModal.vue'
import CreatNewFileModal from '../pan/topbtns/CreatNewFileModal.vue'
import CreatNewAlbumModal from '../pan/topbtns/CreatNewAlbumModal.vue'
import RenameModal from '../pan/topbtns/RenameModal.vue'
import RenameMultiModal from '../pan/topbtns/RenameMultiModal.vue'
import CreatNewDirModal from '../pan/topbtns/CreatNewDirModal.vue'
import DaoRuShareLinkModal from '../share/share/DaoRuShareLinkModal.vue'
import EditShareLinkModal from '../share/share/EditShareLinkModal.vue'
import DaoRuShareLinkMultiModal from '../share/share/DaoRuShareLinkMultiModal.vue'
import ShowShareLinkModal from '../share/share/ShowShareLinkModal.vue'
import SelectPanDirModal from '../pan/topbtns/SelectPanDirModal.vue'
import CreatNewShareLinkModal from '../share/share/CreatNewShareLinkModal.vue'
import ShuXingModal from '../pan/topbtns/ShuXingModal.vue'
import SearchPanModal from '../pan/topbtns/SearchPanModal.vue'
import DLNAPlayerModal from '../pan/topbtns/DLNAPlayerModal.vue'
import M3U8DownloadModal from '../pan/topbtns/M3U8DownloadModal.vue'
import CopyFileTreeModal from '../pan/topbtns/CopyFileTreeModal.vue'
import ArchiveModal from '../pan/topbtns/ArchiveModal.vue'
import ArchivePasswordModal from '../pan/topbtns/ArchivePasswordModal.vue'
import UploadModal from '../pan/topbtns/UploadModal.vue'
import DownloadModal from '../pan/topbtns/DownloadModal.vue'
import MoveToAlbumModal from '../pan/topbtns/MoveToAlbumModal.vue'
import ShowUpdateLog from '../pan/topbtns/ShowUpdateLog.vue'
import PostModal from '../pan/topbtns/PostModal.vue'
import UserRewardSpace from '../user/UserRewardSpace.vue'
import PasswordModal from '../pan/topbtns/PasswordModal.vue'
import SelectVideoQualityModal from '../pan/topbtns/SelectVideoQualityModal.vue'
import Cloud123OfflineDownloadModal from '../down/Cloud123OfflineDownloadModal.vue'
import Drive115OfflineManagementModal from '../down/Drive115OfflineManagementModal.vue'
import Cloud123PaidShareModal from '../share/share/Cloud123PaidShareModal.vue'

export default defineComponent({
  components: {
    SelectVideoQualityModal,
    Cloud123OfflineDownloadModal,
    Drive115OfflineManagementModal,
    Cloud123PaidShareModal,
    PasswordModal,
    UserRewardSpace,
    UserSpaceModal,
    RenameModal,
    RenameMultiModal,
    MoveToAlbumModal,
    CreatNewFileModal,
    CreatNewAlbumModal,
    CreatNewDirModal,
    CreatNewShareLinkModal,
    DaoRuShareLinkModal,
    EditShareLinkModal,
    DaoRuShareLinkMultiModal,
    ShowShareLinkModal,
    SelectPanDirModal,
    ShuXingModal,
    SearchPanModal,
    DLNAPlayerModal,
    M3U8DownloadModal,
    CopyFileTreeModal,
    ArchiveModal,
    ArchivePasswordModal,
    UploadModal,
    DownloadModal,
    ShowUpdateLog,
    PostModal
  },
  setup() {
    const modalStore = useModalStore()
    return { modalStore }
  }
})
</script>

<template>
  <UserSpaceModal :visible="modalStore.modalName == 'userspace'" />
  <UserRewardSpace :visible="modalStore.modalName == 'userrewardspace'" :user_id="modalStore.modalData.user_id || ''" />
  <CreatNewFileModal :visible="modalStore.modalName == 'creatfile'" :encType="modalStore.modalData.encType || ''" />
  <CreatNewAlbumModal :visible="modalStore.modalName == 'creatalbum'" />
  <MoveToAlbumModal :visible="modalStore.modalName == 'movetoalbum'" :istree='modalStore.modalData.istree || false' />
  <CreatNewDirModal :visible="modalStore.modalName == 'creatdir'"
                    :dirtype="modalStore.modalData.dirtype || ''"
                    :encType="modalStore.modalData.encType || ''"
                    :parentdirid="modalStore.modalData.parentdirid || ''"
                    :callback='modalStore.modalData.callback' />
  <CreatNewShareLinkModal :visible="modalStore.modalName == 'creatshare'"
                          :sharetype="modalStore.modalData.sharetype || ''"
                          :driveType="modalStore.modalData.driveType || ''"
                          :filelist='modalStore.modalData.filelist || []' />

  <DaoRuShareLinkModal :visible="modalStore.modalName == 'daorushare'"
                       :shareUrl="modalStore.modalData.shareUrl || ''"
                       :sharePwd="modalStore.modalData.sharePwd || ''" />
  <DaoRuShareLinkMultiModal :visible="modalStore.modalName == 'daorusharemulti'" />

  <RenameModal :visible="modalStore.modalName == 'rename'"
               :istree='modalStore.modalData.istree || false'
               :ispic='modalStore.modalData.ispic || false' />
  <RenameMultiModal :visible="modalStore.modalName == 'renamemulti'" :istree='modalStore.modalData.istree || false' />
  <ShuXingModal :visible="modalStore.modalName == 'shuxing'"
                :istree='modalStore.modalData.istree || false'
                :inputselectType="modalStore.modalData.inputselectType || ''"
                :ispic='modalStore.modalData.ispic || false' />
  <SearchPanModal :visible="modalStore.modalName == 'searchpan'"
                  :inputsearchType="modalStore.modalData.inputsearchType || []" />

  <DLNAPlayerModal :visible="modalStore.modalName == 'dlna'" />
  <M3U8DownloadModal :visible="modalStore.modalName == 'm3u8download'" />
  <CopyFileTreeModal :visible="modalStore.modalName == 'copyfiletree'"
                     :filelist='modalStore.modalData.filelist || []' />
  <ArchiveModal
    :visible="modalStore.modalName == 'archive'"
    :user_id="modalStore.modalData.user_id || ''"
    :drive_id="modalStore.modalData.drive_id || ''"
    :file_id="modalStore.modalData.file_id || ''"
    :file_name="modalStore.modalData.file_name || ''"
    :parent_file_id="modalStore.modalData.parent_file_id || ''"
    :password="modalStore.modalData.password || ''" />
  <ArchivePasswordModal
    :visible="modalStore.modalName == 'archivepassword'"
    :user_id="modalStore.modalData.user_id || ''"
    :drive_id="modalStore.modalData.drive_id || ''"
    :file_id="modalStore.modalData.file_id || ''"
    :file_name="modalStore.modalData.file_name || ''"
    :parent_file_id="modalStore.modalData.parent_file_id || ''"
    :password="modalStore.modalData.password || ''"
    :domain_id="modalStore.modalData.domain_id || ''"
    :ext="modalStore.modalData.ext || ''" />

  <EditShareLinkModal :visible="modalStore.modalName == 'editshare'"
                      :sharelist='modalStore.modalData.sharelist || []' />
  <ShowShareLinkModal
    :visible="modalStore.modalName == 'showshare'"
    :share_id="modalStore.modalData.share_id || ''"
    :share_pwd="modalStore.modalData.share_pwd || ''"
    :share_token="modalStore.modalData.share_token || ''"
    :withsave='modalStore.modalData.withsave || false'
    :save_db='modalStore.modalData.save_db || false'
    :file_id_list='modalStore.modalData.file_id_list || []' />

  <UploadModal :visible="modalStore.modalName == 'upload'"
               :file_id="modalStore.modalData.file_id || ''"
               :filelist='modalStore.modalData.filelist || []'
               :ispic='modalStore.modalData.ispic || false'
               :encType="modalStore.modalData.encType || ''" />
  <DownloadModal :visible="modalStore.modalName == 'download'" :istree='modalStore.modalData.istree || false' />

  <SelectPanDirModal :visible="modalStore.modalName == 'selectpandir'"
                     :selecttype="modalStore.modalData.selecttype || ''"
                     :selectid="modalStore.modalData.selectid || ''"
                     :initial-user-id="modalStore.modalData.user_id || ''"
                     :initial-drive-id="modalStore.modalData.drive_id || ''"
                     :category='modalStore.modalData.category'
                     :extFilter='modalStore.modalData.extFilter'
                     :callback='modalStore.modalData.callback' />

  <ShowUpdateLog :visible="modalStore.modalName == 'showupdatelog'" />

  <SelectVideoQualityModal :visible="modalStore.modalName == 'selectvideoquality'"
                           :file-info="modalStore.modalData.fileInfo || {}"
                           :quality-data="modalStore.modalData.qualityData || {}"
                           :callback="modalStore.modalData.callback" />

  <Cloud123OfflineDownloadModal :visible="modalStore.modalName == 'cloud123offline'" />
  <Drive115OfflineManagementModal :visible="modalStore.modalName == 'drive115management'" />
  <Cloud123PaidShareModal :visible="modalStore.modalName == 'cloud123paidshare'" />

  <PostModal :visible="modalStore.modalName == 'showpostmodal'"
             :msg='modalStore.modalData.msg || ""'
             :msgid='modalStore.modalData.msgid || ""' />

  <PasswordModal :visible="modalStore.modalName == 'showpassword'"
                 :optType="modalStore.modalData.optType || 'new'"
                 :callback="modalStore.modalData.callback" />

</template>
<style>
.modalclass .arco-modal-body {
  padding: 24px 16px 16px 16px;
}

.modaltitle .titletips {
  padding: 0 4px;
  font-size: 14px;
  line-height: 25px;
  color: rgb(var(--primary-6));
}

.modaltitle .onerowtitle {
  font-size: 16px;
  line-height: 25px;
  flex-grow: 1;
  white-space: nowrap;
  word-break: keep-all;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-right: 32px;
}

.modalfoot {
  display: flex;
  align-items: center;
}

.modalfoot .tips {
  font-size: 14px;
  line-height: 25px;
  color: var(--color-text-2);
}

.modalfoot button:not(:last-of-type) {
  margin-right: 12px;
}

.modalbody .arco-form-item-label-col {
  padding-right: 4px;
}
</style>
