// ブラウザ内（localStorage）への保存。データはこのPCのブラウザにだけ残ります
import { APP_DEFAULTS } from '../config/settings'
import { EMPTY_KNOWLEDGE } from '../config/knowledge'
import type { Knowledge, SessionRecord } from './types'

export interface AppSettings extends Knowledge {
  apiKey: string
  model: string
  ttsVoice: string
}

const SETTINGS_KEY = 'sales-roleplay:settings'
const HISTORY_KEY = 'sales-roleplay:history'

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 保存できない環境（プライベートモードなど）では何もしない
  }
}

export function loadSettings(): AppSettings {
  return {
    ...EMPTY_KNOWLEDGE,
    apiKey: '',
    model: APP_DEFAULTS.model,
    ttsVoice: '',
    ...read<Partial<AppSettings>>(SETTINGS_KEY, {}),
  }
}

export function saveSettings(s: AppSettings): void {
  write(SETTINGS_KEY, s)
}

/** 社内の知識だけをファイルに書き出す（APIキーは含めない） */
export function exportKnowledge(s: AppSettings): void {
  const data: Knowledge = { ...EMPTY_KNOWLEDGE }
  for (const key of Object.keys(EMPTY_KNOWLEDGE) as (keyof Knowledge)[]) data[key] = s[key]
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'roleplay-settings.json'
  a.click()
  URL.revokeObjectURL(a.href)
}

/** 書き出したファイルを読み込む。知らない項目は無視する */
export async function importKnowledge(file: File): Promise<Partial<Knowledge>> {
  const raw = JSON.parse(await file.text()) as Record<string, unknown>
  const result: Partial<Knowledge> = {}
  for (const key of Object.keys(EMPTY_KNOWLEDGE) as (keyof Knowledge)[]) {
    if (typeof raw[key] === 'string') result[key] = raw[key]
  }
  return result
}

export function loadHistory(): SessionRecord[] {
  return read<SessionRecord[]>(HISTORY_KEY, [])
}

export function saveRecord(r: SessionRecord): void {
  const rest = loadHistory().filter((h) => h.id !== r.id)
  write(HISTORY_KEY, [r, ...rest].slice(0, 50))
}

export function deleteRecord(id: string): void {
  write(
    HISTORY_KEY,
    loadHistory().filter((h) => h.id !== id),
  )
}
