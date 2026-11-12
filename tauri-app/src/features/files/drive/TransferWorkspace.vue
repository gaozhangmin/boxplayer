<script setup lang="ts">
import OriginalWorkspace from './electron/down/index.vue'
import {createTaskWorkspaceState,provideTaskWorkspace} from './taskWorkspacePort'
import './fileitem.css'
import './global.css'
import './theme.css'
import './taskSidebar.css'
import './taskLayout.css'
provideTaskWorkspace(createTaskWorkspaceState())
</script>
<template><section class="source-drive-manager transfer-workspace" aria-label="传输任务"><OriginalWorkspace/></section></template>
<style scoped>
.transfer-workspace{height:100%;min-height:0;min-width:0;--listhoverbg:var(--secondary);--listselectbg:color-mix(in srgb,var(--primary) 18%,var(--background))}
.transfer-workspace :deep(.arco-layout-content){min-height:0;min-width:0;overflow:hidden}
.transfer-workspace :deep(.arco-tabs){height:100%}
.transfer-workspace :deep(.arco-tabs-content){height:100%;padding:0}
.transfer-workspace :deep(.arco-tabs-pane){height:100%}
.transfer-workspace :deep(.hidetabs>.arco-tabs-nav){display:none}
.transfer-workspace :deep(.toppanbtns){min-width:0;flex-wrap:wrap;height:auto!important;min-height:26px;gap:4px}
.transfer-workspace :deep(.toppanbtn){flex-wrap:wrap}
.transfer-workspace :deep(.filename){min-width:0}
@media(max-width:600px){.transfer-workspace :deep(.arco-layout-sider){width:150px!important}.transfer-workspace :deep(.arco-layout-sider-children){width:150px!important}}
</style>
