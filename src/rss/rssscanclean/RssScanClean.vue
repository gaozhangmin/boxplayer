<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Checkbox as AntdCheckbox } from 'ant-design-vue'
import { useUserStore, useWinStore } from '../../store'
import UserDAL from '../../user/userdal'
import message from '../../utils/message'
import { getRemoteSourceLabel, getWebDavConnections } from '../../utils/webdavClient'
import { deleteDriveLargeFiles, scanDriveLargeFiles, type LargeFileItem, type LargeFileScanMode } from '../../utils/drive-tools/largeFiles'
import type { DuplicateDriveTarget } from '../../utils/drive-tools/duplicates'
import { driveToolDriveIdForPlatform, driveToolRootIdFor } from '../../utils/drive-tools/directLinks'

const userStore = useUserStore()
const winStore = useWinStore()
const treeHeight = computed(() => winStore.height - 268)
const driveOptions = ref<DuplicateDriveTarget[]>([])
const selectedDriveKeys = ref<string[]>([])
const mode = ref<LargeFileScanMode>('size')
const fileSize = ref(100)
const loading = ref(false)
const deleting = ref(false)
const result = ref('')
const files = ref<LargeFileItem[]>([])
const selected = ref(new Set<string>())

const driveKey = (target: DuplicateDriveTarget) => `${target.userId}\n${target.driveId}`
const fileKey = (file: LargeFileItem) => `${file.userId}\n${file.driveId}\n${file.fileId}`
const isReadOnlyFile = (file: LargeFileItem) => file.driveId.startsWith('webdav:')
const hasWritableResults = computed(() => files.value.some(file => !isReadOnlyFile(file)))

const loadDriveOptions = async () => {
  const users = await UserDAL.GetUserListFromDB()
  const options: DuplicateDriveTarget[] = []
  const seen = new Set<string>()
  for (const user of users) {
    if (!user?.user_id || !user?.access_token) continue
    const platform = user.tokenfrom || 'aliyun'
    const name = user.nick_name || user.user_name || user.name || user.user_id
    const add = (driveId: string, rootId: string, suffix = '') => {
      if (!driveId) return
      const target = { userId: user.user_id, driveId, rootId, name: `${name}${suffix}` }
      const key = driveKey(target)
      if (!seen.has(key)) {
        seen.add(key)
        options.push(target)
      }
    }
    if (platform === 'aliyun') {
      add(user.resource_drive_id, 'resource_root', ' / 资源盘')
      add(user.backup_drive_id, 'backup_root', ' / 备份盘')
      add(user.default_drive_id, 'root', ' / 默认盘')
    } else {
      const driveId = driveToolDriveIdForPlatform(platform, user.default_drive_id)
      add(driveId, driveToolRootIdFor(driveId), ` / ${platform}`)
    }
  }
  for (const connection of getWebDavConnections()) {
    options.push({ userId: connection.id, driveId: `webdav:${connection.id}`, rootId: '/', name: `${connection.name} / ${getRemoteSourceLabel(connection.kind)}` })
  }
  driveOptions.value = options
  if (!selectedDriveKeys.value.length && options.length) selectedDriveKeys.value = [driveKey(options[0])]
}

const selectedTargets = computed(() => driveOptions.value.filter(target => selectedDriveKeys.value.includes(driveKey(target))))

const reset = () => {
  result.value = ''
  files.value = []
  selected.value = new Set()
}

const handleScan = async () => {
  if (loading.value) return
  if (!selectedTargets.value.length) {
    message.warning('请至少选择一个网盘')
    return
  }
  reset()
  loading.value = true
  try {
    const data = await scanDriveLargeFiles(selectedTargets.value, mode.value, { customSizeMB: fileSize.value })
    result.value = data.report
    files.value = data.files
    if (!data.files.length) message.success('未发现大文件')
  } catch (error: any) {
    message.error(error?.message || '扫描大文件失败')
  } finally {
    loading.value = false
  }
}

const toggleFile = (file: LargeFileItem) => {
  if (isReadOnlyFile(file)) return
  const next = new Set(selected.value)
  const key = fileKey(file)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selected.value = next
}

const toggleAll = () => {
  const keys = files.value.filter(file => !isReadOnlyFile(file)).map(fileKey)
  const allSelected = keys.length > 0 && keys.every(key => selected.value.has(key))
  selected.value = allSelected ? new Set() : new Set(keys)
}

const handleDelete = async () => {
  if (deleting.value) return
  const selectedFiles = files.value.filter(file => !isReadOnlyFile(file) && selected.value.has(fileKey(file)))
  if (!selectedFiles.length) {
    message.warning('请先勾选需要删除的文件')
    return
  }
  if (!window.confirm(`准备删除 ${selectedFiles.length} 个文件，是否继续？`)) return
  deleting.value = true
  try {
    const data = await deleteDriveLargeFiles(selectedFiles)
    result.value = data.report
    const deleted = new Set(data.deletedFileKeys)
    files.value = files.value.filter(file => !deleted.has(fileKey(file)))
    selected.value = new Set()
    if (data.failed) message.warning('部分文件删除失败，请查看报告')
    else message.success('大文件删除操作完成')
  } catch (error: any) {
    message.error(error?.message || '删除大文件失败')
  } finally {
    deleting.value = false
  }
}

onMounted(loadDriveOptions)
watch(userStore.$state, async () => {
  reset()
  await loadDriveOptions()
})
</script>

<template>
  <div class="scanfill rightbg">
    <div class="settingcard scanfix" style="padding: 12px 24px 8px 24px">
      <a-steps>
        <a-step :description="loading ? '正在扫描目录和文件' : result || '选择网盘后开始扫描'">扫描</a-step>
        <a-step description="勾选需要删除的文件">勾选</a-step>
        <a-step description="按网盘能力执行删除">删除</a-step>
      </a-steps>
    </div>

    <div class="settingcard scanauto" style="padding: 12px; margin-top: 4px">
      <div class="scan-toolbar">
        <a-select v-model="selectedDriveKeys" multiple allow-clear placeholder="选择网盘" :disabled="loading" style="min-width: 260px; flex: 1">
          <a-option v-for="target in driveOptions" :key="driveKey(target)" :value="driveKey(target)">{{ target.name }}</a-option>
        </a-select>
        <a-select v-model="mode" :disabled="loading" style="width: 150px">
          <a-option value="size">自定义</a-option>
          <a-option value="video">视频&gt;1G</a-option>
          <a-option value="doc">文档&gt;1G</a-option>
          <a-option value="zip">压缩包&gt;1G</a-option>
          <a-option value="others">其他&gt;1G</a-option>
          <a-option value="size5000">全部&gt;5G</a-option>
          <a-option value="size1000">全部&gt;1G</a-option>
          <a-option value="size100">全部&gt;100MB</a-option>
        </a-select>
        <a-input-number v-if="mode === 'size'" v-model="fileSize" :disabled="loading" style="width: 150px" :min="1" :max="100000" :step="100">
          <template #prefix>大于</template>
          <template #suffix>MB</template>
        </a-input-number>
        <a-button type="primary" :loading="loading" @click="handleScan">开始扫描</a-button>
        <a-button v-if="hasWritableResults" :disabled="!files.length" @click="toggleAll">全选/取消</a-button>
        <a-button v-if="hasWritableResults" status="danger" :disabled="!selected.size" :loading="deleting" @click="handleDelete">删除选中</a-button>
      </div>
      <div class="scan-hint">按当前阈值递归扫描所选网盘。不同网盘返回的分类信息可能不同，文档/压缩包模式会同时参考文件扩展名。</div>
      <pre v-if="result" class="scan-report">{{ result }}</pre>
      <a-spin :loading="loading" :style="{ width: '100%', minHeight: treeHeight + 'px' }">
        <a-list :bordered="false" :split="false" :max-height="treeHeight" :data="files">
          <template #empty><a-empty description="扫描结束，未发现大文件" /></template>
          <template #item="{ item }">
            <div :key="fileKey(item)" class="largefile-item">
              <AntdCheckbox v-if="!isReadOnlyFile(item)" :checked="selected.has(fileKey(item))" @change="toggleFile(item)" />
              <IconFont :name="item.icon" aria-hidden="true" />
              <div class="largefile-name" :title="item.name">{{ item.name }}</div>
              <div class="largefile-path" :title="item.path">{{ item.path }}</div>
              <div class="largefile-size">{{ item.sizeStr }}</div>
            </div>
          </template>
        </a-list>
      </a-spin>
    </div>
  </div>
</template>

<style>
.scan-toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.scan-hint { margin: 10px 0; color: var(--color-text-3); font-size: 12px; line-height: 1.6; }
.scan-report { margin: 0 0 8px; white-space: pre-wrap; word-break: break-word; color: var(--color-text-2); font-size: 12px; }
.largefile-item { display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 0 8px; border-bottom: 1px solid var(--color-border-1); }
.largefile-name { width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.largefile-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-text-4); font-size: 12px; }
.largefile-size { color: var(--color-text-4); font-size: 12px; white-space: nowrap; }
</style>
