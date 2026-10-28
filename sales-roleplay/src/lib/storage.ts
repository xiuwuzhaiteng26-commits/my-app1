// ブラウザ内（localStorage）への保存。データはこのPCのブラウザにだけ残ります
import { APP_DEFAULTS, type PausePreset } from '../config/settings'
import { EMPTY_KNOWLEDGE } from '../config/knowledge'
import type { LlmConfig, Provider } from './llm'
import type { Knowledge, SessionRecord } from './types'

export interface AppSettings extends Knowledge {
  provider: Provider
  claudeApiKey: string
  claudeModel: string
  /** Gemini のAPIキー */
  apiKey: string
  /** Gemini のモデル（シナリオ作成・評価） */
  model: string
  /** Gemini のモデル（商談中の返事） */
  geminiChatModel: string
  pausePreset: PausePreset
  ttsVoice: string
}

/** 設定から、今使うAIの接続情報を取り出す */
export function llmConfig(s: AppSettings): LlmConfig {
  return s.provider === 'claude'
    ? { provider: 'claude', apiKey: s.claudeApiKey, model: s.claudeModel }
    : { provider: 'gemini', apiKey: s.apiKey, model: s.model }
}

/** 商談中の返事用の接続情報（速さを優先したモデル。使えなければ通常のモデルに戻す） */
export function chatLlmConfig(s: AppSettings): LlmConfig & { fallbackModel?: string } {
  const base = llmConfig(s)
  if (s.provider !== 'gemini' || !s.geminiChatModel.trim() || s.geminiChatModel === s.model) return base
  return { ...base, model: s.geminiChatModel.trim(), fallbackModel: s.model }
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
    provider: APP_DEFAULTS.provider,
    claudeApiKey: '',
    claudeModel: APP_DEFAULTS.claudeModel,
    apiKey: '',
    model: APP_DEFAULTS.model,
    geminiChatModel: APP_DEFAULTS.geminiChatModel,
    pausePreset: APP_DEFAULTS.pausePreset,
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
