import { app, ipcMain, type WebContents } from 'electron'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { fork } from 'node:child_process'
import path from 'node:path'
import { getEmbeddedMpvNativeAddonCandidates } from './embeddedMpvNativeAddon'
import { buildMpvLoadOptions } from './embeddedMpvLoadOptions'

interface Deck {
  load(url: string, options: string): void
  play(): void; pause(): void; seek(position: number): void
  setVolume(value: number): void; setSpeed(value: number): void
  setVideoProperty(name: string, value: string): void
  getStatus(): { ready: boolean; playing: boolean; paused: boolean; buffering: boolean; error?: string; [key: string]: unknown }
  destroy(): void
}
interface Slot { id: string; deck: Deck }
const requireNative = createRequire(import.meta.url)
let factory: (() => Deck) | undefined

function linuxAudioDeck(addonPath: string): Deck {
  const directory = path.dirname(addonPath)
  const child = fork(path.join(directory, 'mpv-host.cjs'), [], {
    execPath: path.join(directory, 'mpv-node-host'), execArgv: [],
    stdio: ['ignore','ignore','ignore','ipc'], serialization: 'advanced',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }
  })
  let closed = false, ready = false
  let status: ReturnType<Deck['getStatus']> = {ready:false,playing:false,paused:true,buffering:false}
  const queue: {type:string;method:string;args:unknown[]}[] = []
  const send = (method:string,...args:unknown[]) => {
    if(closed)return
    const message = {type:'command',method,args}
    if(ready&&child.connected)child.send(message);else queue.push(message)
  }
  const destroy = () => {if(closed)return;closed=true;queue.length=0;if(child.connected)child.send({type:'destroy'});const timer=setTimeout(()=>child.kill(),2000);timer.unref()}
  child.on('error',error=>{status={...status,error:error.message,ready:false}})
  child.on('exit',()=>{if(!closed)status={...status,error:'Music audio host exited',ready:false}})
  child.on('message',(message:any)=>{
    if(closed)return
    if(message.type==='ready'){ready=true;for(const item of queue.splice(0))if(child.connected)child.send(item)}
    if(message.status)status=message.status
    if(message.type==='error')status={...status,error:message.error,ready:false}
  })
  child.send({type:'create-audio'})
  return {load:(url,options)=>send('load',url,options),play:()=>send('play'),pause:()=>send('pause'),
    seek:value=>send('seek',value),setVolume:value=>send('setVolume',value),setSpeed:value=>send('setSpeed',value),
    setVideoProperty:(name,value)=>send('setVideoProperty',name,value),getStatus:()=>status,destroy}
}

function audioFactory(): (() => Deck) | undefined {
  if (factory) return factory
  for (const path of getEmbeddedMpvNativeAddonCandidates()) {
    if (!existsSync(path)) continue
    try {
      if(process.platform==='linux') {
        const directory=path.substring(0,path.lastIndexOf('/'))
        const host=directory+'/mpv-host.cjs'
        if(existsSync(directory+'/mpv-node-host')&&existsSync(host)&&readFileSync(host,'utf8').includes("create-audio"))
          return factory=()=>linuxAudioDeck(path)
        continue
      }
      const module = requireNative(path)
      if (typeof module.createAudioDeck === 'function') return factory = module.createAudioDeck
    } catch { /* Keep trying the other architecture-matching bundle candidates. */ }
  }
}

class MusicAudioOwner {
  active?: Slot
  prepared?: Slot
  outgoing?: Slot
  volume = 100
  progress = 1
  private timer?: ReturnType<typeof setInterval>
  private paused = true

  closeSlot(slot?: Slot) { try { slot?.deck.destroy() } catch { /* Continue disposing the other deck. */ } }
  cancelTransition() {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.closeSlot(this.prepared); this.prepared = undefined
    this.closeSlot(this.outgoing); this.outgoing = undefined
    this.progress = 1
    this.mix()
  }
  close() {
    this.cancelTransition()
    this.closeSlot(this.active); this.active = undefined
  }
  mix() {
    this.active?.deck.setVolume(this.volume * this.progress)
    this.outgoing?.deck.setVolume(this.volume * (1 - this.progress))
  }
  load(data: any, prepare: boolean) {
    const create = audioFactory()
    if (!create) return { ok: false, unsupported: true }
    if (!data || typeof data.url !== 'string' || !data.url || typeof data.sessionId !== 'string' || !data.sessionId)
      return { ok: false, error: 'Invalid music playback request' }
    if (prepare && (!this.active || data.ownerSessionId !== this.active.id)) return { ok: false, error: 'Music session was replaced' }
    if (prepare && this.outgoing) return { ok: false, error: 'A music transition is still active' }
    let deck: Deck | undefined
    try {
      deck = create()
      deck.setVolume(0)
      deck.load(data.url, buildMpvLoadOptions({ ...data, audioOnly: true }))
      const slot = { id: data.sessionId, deck }
      if (prepare) {
        this.closeSlot(this.prepared); this.prepared = slot
      } else {
        this.close()
        this.active = slot; this.paused = true; this.mix()
      }
      return { ok: true, sessionId: slot.id }
    } catch (error: any) {
      try { deck?.destroy() } catch { /* Failed initialization must still be disposable. */ }
      return { ok: false, error: error?.message || 'Music deck initialization failed' }
    }
  }
  status() {
    if (!this.active) return { ok: false, error: 'No active music session' }
    try {
      const status = this.active.deck.getStatus()
      const preparedStatus = this.prepared?.deck.getStatus()
      return { ok: !status.error, sessionId: this.active.id, status, error: status.error,
        preparedSessionId: this.prepared?.id, preparedReady: !!preparedStatus?.ready && !preparedStatus.error,
        transitioning: !!this.outgoing }
    } catch (error: any) { return { ok: false, error: error?.message || 'Music status unavailable' } }
  }
  control(data: any) {
    const slot = [this.active, this.prepared].find(slot => slot?.id === data?.sessionId)
    if (!slot) return { ok: false, error: 'Music session was replaced' }
    try {
      switch (data.action) {
        case 'activatePrepared': {
          if (slot !== this.active || this.outgoing || !this.prepared || this.prepared.id !== data.nextSessionId)
            return { ok: false, error: 'Prepared music session was replaced' }
          const status = this.prepared.deck.getStatus()
          if (!status.ready || status.error) return { ok: false, error: status.error || 'Next track is not ready' }
          this.outgoing = this.active; this.active = this.prepared; this.prepared = undefined
          this.progress = 0; this.mix(); this.active.deck.play()
          if (this.paused) this.active.deck.pause()
          let previous = Date.now()
          this.timer = setInterval(() => {
            const now = Date.now(), elapsed = Math.min(100, now - previous); previous = now
            try {
              if (!this.paused && this.active?.deck.getStatus().playing) this.progress = Math.min(1, this.progress + elapsed / 3000)
              this.mix()
              if (this.progress >= 1) {
                if (this.timer) clearInterval(this.timer)
                this.timer = undefined; this.closeSlot(this.outgoing); this.outgoing = undefined
              }
            } catch { this.cancelTransition() }
          }, 50)
          this.timer.unref?.()
          return { ok: true, sessionId: this.active.id }
        }
        case 'cancelTransition': this.cancelTransition(); break
        case 'play': this.paused = false; slot.deck.play(); this.outgoing?.deck.play(); break
        case 'pause': this.paused = true; slot.deck.pause(); this.outgoing?.deck.pause(); break
        case 'seek': this.cancelTransition(); slot.deck.seek(Number(data.value)); break
        case 'setVolume':
          if (slot === this.active && Number.isFinite(data.value)) { this.volume = Math.max(0, Math.min(100, data.value)); this.mix() }
          break
        case 'setSpeed': slot.deck.setSpeed(Number(data.value)); this.outgoing?.deck.setSpeed(Number(data.value)); break
        case 'setVideoProperty': slot.deck.setVideoProperty(String(data.property), String(data.propertyValue)); break
        case 'stop': this.close(); break
        default: return { ok: false, error: 'Unsupported music action' }
      }
      return { ok: true }
    } catch (error: any) { return { ok: false, error: error?.message || 'Music control failed' } }
  }
}

const owners = new Map<number, MusicAudioOwner>()
function owner(sender: WebContents) {
  let value = owners.get(sender.id)
  if (!value) {
    value = new MusicAudioOwner(); owners.set(sender.id, value)
    sender.once('destroyed', () => { value?.close(); owners.delete(sender.id) })
  }
  return value
}
export function registerMusicAudioIpc() {
  ipcMain.handle('MusicAudio:capability', () => ({ available: !!audioFactory() }))
  ipcMain.handle('MusicAudio:load', (event, data) => owner(event.sender).load(data, data?.prepare === true))
  ipcMain.handle('MusicAudio:control', (event, data) => owner(event.sender).control(data))
  ipcMain.handle('MusicAudio:status', event => owner(event.sender).status())
  app.once('before-quit', () => { for (const value of owners.values()) value.close(); owners.clear() })
}
