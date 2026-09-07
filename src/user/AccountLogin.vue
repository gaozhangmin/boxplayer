<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { X, Loader2, Github, Chrome, Mail } from 'lucide-vue-next'
import { openExternal } from '../utils/electronhelper'
import message from '../utils/message'
import { clearBoxPlayerAppSession, getBoxPlayerSupabase } from '../utils/boxplayerAuth'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ 'update:visible': [v: boolean]; login: [user: { email: string }] }>()

const loading = ref(false)
const emailInput = ref('')
const codeSent = ref(false)
const emailCode = ref('')

const CALLBACK_URL = 'boxplayer-auth://callback'

const supabase = getBoxPlayerSupabase()

function saveUser(email: string) {
  localStorage.setItem('app_user_email', email)
  localStorage.setItem('app_user_authed', '1')
  emit('login', { email })
}

// ── OAuth ──
async function handleOAuth(provider: 'github' | 'google') {
  if (!supabase) { message.error('未配置 Supabase'); return }
  loading.value = true
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: CALLBACK_URL, skipBrowserRedirect: true },
    })
    if (error) { message.error(error.message) }
    else if (data.url) {
      openExternal(data.url)
    }
  } catch (e: any) { message.error(e?.message || 'OAuth 失败') }
  finally { loading.value = false }
}

// ── Email OTP ──
async function handleEmailSend() {
  const email = emailInput.value.trim()
  if (!email?.includes('@')) { message.warning('请输入有效邮箱'); return }
  if (!supabase) { message.error('未配置 Supabase'); return }
  loading.value = true
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    })
    if (error) message.error(error.message)
    else { codeSent.value = true; message.success('验证码已发送到邮箱') }
  } catch (e: any) { message.error(e?.message || '发送失败') }
  finally { loading.value = false }
}

async function handleEmailVerify() {
  const email = emailInput.value.trim()
  const token = emailCode.value.trim()
  if (!token) { message.warning('请输入验证码'); return }
  if (!supabase) { message.error('未配置 Supabase'); return }
  loading.value = true
  try {
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    })
    if (error) { message.error(error.message) }
    else if (data.user) {
      clearBoxPlayerAppSession()
      saveUser(data.user.email || email)
      message.success('登录成功')
      emit('update:visible', false)
    }
  } catch (e: any) { message.error(e?.message || '验证失败') }
  finally { loading.value = false }
}

// ── OAuth callback from Electron ──
function setupCallbackListener() {
  const handler = (event: Event) => {
    const result = (event as CustomEvent<{ email?: string }>).detail
    saveUser(result?.email || '')
    message.success('登录成功')
    emit('update:visible', false)
  }
  window.addEventListener('boxplayer-auth-restored', handler)
  onUnmounted(() => window.removeEventListener('boxplayer-auth-restored', handler))
}

onMounted(setupCallbackListener)
</script>

<template>
  <div v-if="visible" class="al-mask" @click.self="emit('update:visible', false)">
    <div class="al-card">
      <div class="al-header">
        <span>登录账户</span>
        <button class="al-close" @click="emit('update:visible', false)"><X :size="18" :stroke-width="2" /></button>
      </div>

      <div class="al-body">
        <button class="al-btn al-btn-github" :disabled="loading" @click="handleOAuth('github')">
          <Github :size="18" :stroke-width="1.5" /><span>GitHub 登录</span>
        </button>
        <button class="al-btn al-btn-google" :disabled="loading" @click="handleOAuth('google')">
          <Chrome :size="18" :stroke-width="1.5" /><span>Google 登录</span>
        </button>

        <div class="al-divider"><span>或使用邮箱</span></div>

        <template v-if="!codeSent">
          <div class="al-field">
            <Mail :size="14" :stroke-width="1.5" class="al-field-icon" />
            <input v-model="emailInput" type="email" class="al-input" placeholder="输入邮箱地址" />
          </div>
          <button class="al-btn al-btn-email" :disabled="loading || !emailInput.trim()" @click="handleEmailSend">
            <Loader2 v-if="loading" :size="16" :stroke-width="2" class="al-spin" />
            <span v-else>发送验证码</span>
          </button>
        </template>
        <template v-else>
          <div class="al-field">
            <input v-model="emailCode" type="text" class="al-input" placeholder="输入验证码" maxlength="6" @keydown.enter="handleEmailVerify" />
          </div>
          <button class="al-btn al-btn-email" :disabled="loading || emailCode.length < 4" @click="handleEmailVerify">
            <Loader2 v-if="loading" :size="16" :stroke-width="2" class="al-spin" />
            <span v-else>验证并登录</span>
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.al-mask{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:1100}
.al-card{width:380px;max-width:92vw;background:var(--color-bg-2);border:1px solid var(--color-border);border-radius:14px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.15)}
.al-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;font-size:16px;font-weight:600;color:var(--color-text-1);border-bottom:1px solid var(--color-border)}
.al-close{display:flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;color:var(--color-text-3);background:transparent;border:0;border-radius:6px;cursor:pointer}
.al-close:hover{background:var(--color-fill-2);color:var(--color-text-1)}
.al-body{padding:20px;display:flex;flex-direction:column;gap:12px}
.al-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:12px;font-size:14px;font-weight:500;border:1px solid var(--color-border);border-radius:10px;cursor:pointer;font-family:inherit;transition:all .15s;color:var(--color-text-1);background:var(--color-bg-1)}
.al-btn:hover:not(:disabled){background:var(--color-fill-1);border-color:var(--color-border-2)}
.al-btn:disabled{opacity:.5;cursor:default}
.al-btn-github{background:#24292e;color:#fff;border-color:#24292e}
.al-btn-github:hover:not(:disabled){background:#1a1f23}
.al-btn-google{background:#fff;color:#444;border-color:#ddd}
.al-btn-google:hover:not(:disabled){background:#f5f5f5}
.al-btn-email{background:rgb(var(--primary-6));color:#fff;border-color:transparent}
.al-btn-email:hover:not(:disabled){opacity:.9}
.al-divider{display:flex;align-items:center;gap:12px;font-size:12px;color:var(--color-text-4)}
.al-divider::before,.al-divider::after{content:'';flex:1;height:1px;background:var(--color-border)}
.al-field{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--color-fill-1);border:1px solid var(--color-border);border-radius:10px}
.al-field-icon{color:var(--color-text-4);flex-shrink:0}
.al-input{flex:1;padding:0;font-size:14px;color:var(--color-text-1);background:transparent;border:0;outline:none;font-family:inherit}
.al-input::placeholder{color:var(--color-text-4)}
.al-spin{animation:al-spin 1s linear infinite}
@keyframes al-spin{to{transform:rotate(360deg)}}
</style>
