import {useFileSourcesStore} from '@/stores/fileSources'
export const isIndependentCategoryRoute=(route:string)=>route.startsWith('home-entry/')
export default function useCategoryPlacement(){return {state(route:string){const card=useFileSourcesStore().cards.find(card=>route==='home-entry/'+card.id);return {placed:!!card,favorite:!!card,home:false}}}}
