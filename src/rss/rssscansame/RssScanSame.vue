<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Checkbox as AntdCheckbox } from 'ant-design-vue'
import { useUserStore, useWinStore } from '../../store'
import UserDAL from '../../user/userdal'
import message from '../../utils/message'
import { deleteDriveDuplicates, scanDriveDuplicates, type DuplicateDriveTarget, type DuplicateFileItem, type DuplicateGroup, type DuplicateScanMode } from '../../utils/drive-tools/duplicates'
import { driveToolDriveIdForPlatform, driveToolRootIdFor } from '../../utils/drive-tools/directLinks'
import { getRemoteSourceLabel, getWebDavConnections } from '../../utils/webdavClient'

const userStore = useUserStore()
const winStore = useWinStore()
const treeHeight = computed(() => winStore.height - 268)
const driveOptions = ref<DuplicateDriveTarget[]>([])
const selectedDriveKeys = ref<string[]>([])
const mode = ref<DuplicateScanMode>('helperName')
const numberText = ref('1,2,3')
const loading = ref(false)
const deleting = ref(false)
const result = ref('')
const groups = ref<DuplicateGroup[]>([])
const selected = ref(new Set<string>())

const driveKey = (target: DuplicateDriveTarget) => `${target.userId}\n${target.driveId}`
const fileKey = (file: DuplicateFileItem) => `${file.userId}\n${file.driveId}\n${file.fileId}`
const isReadOnlyFile = (file: DuplicateFileItem) => file.driveId.startsWith('webdav:')
const hasWritableResults = computed(() => groups.value.some(group => group.files.some(file => !isReadOnlyFile(file))))
const groupHasWritableFiles = (group: DuplicateGroup) => group.files.some(file => !isReadOnlyFile(file))

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
  groups.value = []
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
    const data = await scanDriveDuplicates(selectedTargets.value, mode.value, { numbers: numberText.value })
    result.value = data.report
    groups.value = data.groups
    if (!data.groups.length) message.success('未发现重复项')
  } catch (error: any) {
    message.error(error?.message || '扫描重复文件失败')
  } finally {
    loading.value = false
  }
}

const toggleFile = (file: DuplicateFileItem) => {
  if (isReadOnlyFile(file)) return
  const next = new Set(selected.value)
  const key = fileKey(file)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selected.value = next
}

const toggleGroup = (group: DuplicateGroup) => {
  const keys = group.files.filter(file => !isReadOnlyFile(file)).map(fileKey)
  const allSelected = keys.every(key => selected.value.has(key))
  const next = new Set(selected.value)
  keys.forEach(key => allSelected ? next.delete(key) : next.add(key))
  selected.value = next
}

const handleDelete = async () => {
  if (deleting.value) return
  const files = groups.value.flatMap(group => group.files).filter(file => !isReadOnlyFile(file) && selected.value.has(fileKey(file)))
  if (!files.length) {
    message.warning('请先勾选需要删除的文件')
    return
  }
  if (!window.confirm(`准备删除 ${files.length} 个重复候选文件，是否继续？`)) return
  deleting.value = true
  try {
    const data = await deleteDriveDuplicates(files)
    result.value = data.report
    const deleted = new Set(data.deletedFileKeys)
    groups.value = groups.value.map(group => ({ ...group, files: group.files.filter(file => !deleted.has(fileKey(file))) })).filter(group => group.files.length)
    selected.value = new Set()
    if (data.failed) message.warning('部分文件删除失败，请查看报告')
    else message.success('重复文件删除操作完成')
  } catch (error: any) {
    message.error(error?.message || '删除重复文件失败')
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
          <a-option value="helperName">光鸭重复项</a-option>
          <a-option value="contentHash">内容哈希重复</a-option>
        </a-select>
        <a-input v-if="mode === 'helperName'" v-model="numberText" :disabled="loading" style="width: 120px" placeholder="编号，如 1,2,3" />
        <a-button type="primary" :loading="loading" @click="handleScan">开始扫描</a-button>
        <a-button v-if="hasWritableResults" status="danger" :disabled="!selected.size" :loading="deleting" @click="handleDelete">删除选中</a-button>
      </div>
      <div class="scan-hint">光鸭重复项规则：匹配文件名末尾的 (1)、(2)、(3)，支持中文括号、全角数字和扩展名。内容哈希模式按各网盘返回的 content_hash 判重。</div>
      <pre v-if="result" class="scan-report">{{ result }}</pre>
      <a-spin :loading="loading" :style="{ width: '100%', minHeight: treeHeight + 'px' }">
        <a-list :bordered="false" :split="false" :max-height="treeHeight" :data="groups">
          <template #empty><a-empty description="扫描结束，未发现重复项" /></template>
          <template #item="{ item, index }">
            <div :key="item.key" class="sameitem">
              <div class="samehash">
                <span>#{{ index + 1 }}：{{ item.label }}</span>
                <a-button v-if="groupHasWritableFiles(item)" type="text" size="mini" @click="toggleGroup(item)">全选/取消</a-button>
              </div>
              <div v-for="file in item.files" :key="fileKey(file)" class="samefile">
                <AntdCheckbox v-if="!isReadOnlyFile(file)" :checked="selected.has(fileKey(file))" @change="toggleFile(file)" />
                <IconFont :name="file.icon" aria-hidden="true" />
                <div class="samename" :title="file.name">{{ file.name }}</div>
                <div class="samepath" :title="file.path">{{ file.path }}</div>
                <div class="sametime">{{ file.sizeStr }} {{ file.timeStr }}</div>
              </div>
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
.sameitem { padding: 10px 12px; border: 1px solid var(--color-border-1); }
.samehash { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; color: var(--color-text-3); font-size: 13px; }
.samefile { display: flex; align-items: center; gap: 8px; min-height: 32px; }
.samename { width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.samepath { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-text-4); font-size: 12px; }
.sametime { color: var(--color-text-4); font-size: 12px; white-space: nowrap; }
</style>
