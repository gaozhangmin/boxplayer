import '@/style.css'
import App from './App.vue'
import { mountApp } from '@/lib/bootstrap'
import { observeMembershipAccounts } from '@/stores/membership'
mountApp(App).then(observeMembershipAccounts)
