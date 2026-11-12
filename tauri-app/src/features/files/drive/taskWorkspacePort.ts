import {inject,provide,reactive,type InjectionKey} from 'vue'
export const taskTabs=['DowningRight','DownedRight','UploadingRight','UploadedRight'] as const
export type TaskTab=typeof taskTabs[number]
export function createTaskWorkspaceState(initial:TaskTab='DowningRight'){return reactive({GetAppTabMenu:initial,toggleTabMenu(tab:string,menu:string){if(tab==='down'&&taskTabs.includes(menu as TaskTab))this.GetAppTabMenu=menu as TaskTab}})}
const key:InjectionKey<ReturnType<typeof createTaskWorkspaceState>>=Symbol('task-workspace')
export const provideTaskWorkspace=(state:ReturnType<typeof createTaskWorkspaceState>)=>provide(key,state)
export function useAppStore(){const state=inject(key);if(!state)throw Error('传输任务页面已关闭');return state}
