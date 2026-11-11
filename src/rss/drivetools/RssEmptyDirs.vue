<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Checkbox as AntdCheckbox } from 'ant-design-vue'
import { useUserStore, useWinStore } from '../../store'
import UserDAL from '../../user/userdal'
import message from '../../utils/message'
import { getRemoteSourceLabel, getWebDavConnections } from '../../utils/webdavClient'
import { deleteDriveEmptyDirs, scanDriveEmptyDirs, type EmptyDirItem } from '../../utils/drive-tools/emptyDirs'
import type { DuplicateDriveTarget } from '../../utils/drive-tools/duplicates'
import { driveToolDriveIdForPlatform, driveToolRootIdFor } from '../../utils/drive-tools/directLinks'

const userStore = useUserStore()
const winStore = useWinStore()
const treeHeight = computed(() => winStore.height - 268)
const driveOptions = ref<DuplicateDriveTarget[]>([])
const selectedDriveKeys = ref<string[]>([])
const loading = ref(false)
const deleting = ref(false)
const result = ref('')
const emptyDirs = ref<EmptyDirItem[]>([])
const selected = ref(new Set<string>())

const driveKey = (target: DuplicateDriveTarget) => `${target.userId}\n${target.driveId}`
const dirKey = (dir: EmptyDirItem) => `${dir.userId}\n${dir.driveId}\n${dir.fileId}`
const isReadOnlyDir = (dir: EmptyDirItem) => dir.driveId.startsWith('webdav:')
const hasWritableResults = computed(() => emptyDirs.value.some(dir => !isReadOnlyDir(dir)))

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
  emptyDirs.value = []
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
    const results = []
    for (const target of selectedTargets.value) {
      const data = await scanDriveEmptyDirs(target.userId, target.driveId, target.rootId)
      results.push({ target, data })
      emptyDirs.value.push(...data.emptyDirs)
    }
    result.value = results.map(item => `${item.target.name}：${item.data.report}`).join('\n')
    if (!emptyDirs.value.length) message.success('未发现空目录')
    else message.success(`发现 ${emptyDirs.value.length} 个空目录`)
  } catch (error: any) {
    message.error(error?.message || '扫描空目录失败')
  } finally {
    loading.value = false
  }
}

const toggleDir = (dir: EmptyDirItem) => {
  if (isReadOnlyDir(dir)) return
  const next = new Set(selected.value)
  const key = dirKey(dir)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selected.value = next
}

const toggleAll = () => {
  const keys = emptyDirs.value.filter(dir => !isReadOnlyDir(dir)).map(dirKey)
  const allSelected = keys.length > 0 && keys.every(key => selected.value.has(key))
  selected.value = allSelected ? new Set() : new Set(keys)
}

const handleDelete = async () => {
  if (deleting.value) return
  const dirs = emptyDirs.value.filter(dir => !isReadOnlyDir(dir) && selected.value.has(dirKey(dir)))
  if (!dirs.length) {
    message.warning('请先勾选需要删除的空目录')
    return
  }
  if (!window.confirm(`准备删除 ${dirs.length} 个空目录，是否继续？`)) return
  deleting.value = true
  try {
    const data = await deleteDriveEmptyDirs(dirs)
    result.value = data.report
    const deleted = new Set(data.deletedFileKeys)
    emptyDirs.value = emptyDirs.value.filter(dir => !deleted.has(dirKey(dir)))
    selected.value = new Set(Array.from(selected.value).filter(key => !deleted.has(key)))
    if (data.failed) message.warning('部分空目录删除失败，请查看报告')
    else message.success('空目录删除操作完成')
  } catch (error: any) {
    message.error(error?.message || '删除空目录失败')
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
        <a-step :description="loading ? '正在扫描目录树' : result || '选择网盘后开始扫描'">扫描</a-step>
        <a-step description="勾选需要删除的空目录">勾选</a-step>
        <a-step description="按网盘能力执行删除">删除</a-step>
      </a-steps>
    </div>

    <div class="settingcard scanauto" style="padding: 12px; margin-top: 4px">
      <div class="scan-toolbar">
        <a-select v-model="selectedDriveKeys" multiple allow-clear placeholder="选择网盘" :disabled="loading" style="min-width: 260px; flex: 1">
          <a-option v-for="target in driveOptions" :key="driveKey(target)" :value="driveKey(target)">{{ target.name }}</a-option>
        </a-select>
        <a-button type="primary" :loading="loading" @click="handleScan">开始扫描</a-button>
        <a-button v-if="hasWritableResults" :disabled="!emptyDirs.length" @click="toggleAll">全选/取消</a-button>
        <a-button v-if="hasWritableResults" status="danger" :disabled="!selected.size" :loading="deleting" @click="handleDelete">删除选中</a-button>
      </div>
      <div class="scan-hint">扫描每个网盘根目录下最里层且完全空的目录。删除会按对应网盘能力执行，部分网盘可能不支持回收站。</div>
      <pre v-if="result" class="scan-report">{{ result }}</pre>
      <a-spin :loading="loading" :style="{ width: '100%', minHeight: treeHeight + 'px' }">
        <a-list :bordered="false" :split="false" :max-height="treeHeight" :data="emptyDirs">
          <template #empty><a-empty description="扫描结束，未发现空目录" /></template>
          <template #item="{ item }">
            <div :key="dirKey(item)" class="emptydir-item">
              <AntdCheckbox v-if="!isReadOnlyDir(item)" :checked="selected.has(dirKey(item))" @change="toggleDir(item)" />
              <IconFont name="iconfile-folder" aria-hidden="true" />
              <div class="emptydir-name" :title="item.name">{{ item.name }}</div>
              <div class="emptydir-path" :title="item.path">{{ item.path }}</div>
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
.emptydir-item { display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 0 8px; border-bottom: 1px solid var(--color-border-1); }
.emptydir-name { width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.emptydir-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-text-4); font-size: 12px; }
</style>
