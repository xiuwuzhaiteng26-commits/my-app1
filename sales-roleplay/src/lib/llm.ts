// AI（Claude または Gemini）との通信
// どちらを使うかは設定画面で選びます。画面側は generate() / generateJson() / generateStream() だけを呼びます
import Anthropic from '@anthropic-ai/sdk'
import { APP_DEFAULTS } from '../config/settings'

export interface LlmTurn {
  role: 'user' | 'model'
  text: string
}

export type Provider = 'claude' | 'gemini'

export interface LlmConfig {
  provider: Provider
  apiKey: string
  model: string
}

export interface LlmOptions extends LlmConfig {
  system?: string
  json?: boolean
  /** Claude の考える深さ。会話は速さ優先で low、シナリオ作成・評価は medium 以上 */
  effort?: 'low' | 'medium' | 'high'
  /** Gemini だけで使う */
  temperature?: number
}

export async function generate(turns: LlmTurn[], opts: LlmOptions): Promise<string> {
  if (!opts.apiKey) throw new Error('APIキーが設定されていません。「設定」画面で入力してください。')
  return opts.provider === 'claude' ? generateClaude(turns, opts) : generateGemini(turns, opts)
}

export async function generateJson<T>(prompt: string, opts: Omit<LlmOptions, 'json'>): Promise<T> {
  const text = await generate([{ role: 'user', text: prompt }], { ...opts, json: true })
  return parseJson<T>(text)
}

// ---------- Claude ----------

/** 安全確認で断られたときに、同じリクエストを別のモデルで自動的にやり直せるモデル */
const FALLBACK_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-5', 'claude-fable-5-1']

async function generateClaude(turns: LlmTurn[], opts: LlmOptions): Promise<string> {
  const client = claudeClient(opts.apiKey)
  const useFallback = FALLBACK_MODELS.includes(opts.model)
  try {
    const res = await client.beta.messages.create({
      model: opts.model,
      max_tokens: 16000,
      system: opts.system,
      messages: turns.map((t) => ({ role: t.role === 'model' ? 'assistant' : 'user', content: t.text })),
      // 毎回同じ指示文と会話履歴を送るので、キャッシュして料金と待ち時間を減らす
      cache_control: { type: 'ephemeral' },
      output_config: { effort: opts.effort ?? 'medium' },
      ...(useFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    })
    if (res.stop_reason === 'refusal') {
      throw new Error('AIがこの内容への応答を控えました。言い方を変えてもう一度お試しください。')
    }
    const text = res.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
    if (!text) throw new Error('AIから空の応答が返りました。もう一度お試しください。')
    return text
  } catch (e) {
    throw claudeError(e)
  }
}

function claudeClient(apiKey: string): Anthropic {
  // APIキーは各自のブラウザにだけ保存されたものを使う（サーバーを置かないため、ブラウザから直接呼ぶ）
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, timeout: APP_DEFAULTS.aiTimeoutMs, maxRetries: 1 })
}

function claudeError(e: unknown): unknown {
  if (e instanceof Anthropic.APIUserAbortError) return new AbortedError()
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new Error(TIMEOUT_MESSAGE)
  if (e instanceof Anthropic.APIConnectionError) return new Error(NETWORK_MESSAGE)
  if (e instanceof Anthropic.AuthenticationError) return new Error('Claude のAPIキーが正しくありません。「設定」を確認してください。')
  if (e instanceof Anthropic.RateLimitError) return new Error('利用上限に達しました。少し待ってから再度お試しください。')
  if (e instanceof Anthropic.APIError) return new Error(`AIの呼び出しに失敗しました（${e.status}）：${e.message}`)
  return e
}

const TIMEOUT_MESSAGE = `AIの返事が${APP_DEFAULTS.aiTimeoutMs / 1000}秒たっても来ませんでした。混み合っている可能性があります。少し待ってからもう一度押すか、「設定」で速いモデルに変えてみてください。`
const NETWORK_MESSAGE = 'AIと通信できませんでした。インターネットの接続を確認して、もう一度お試しください。'

// ---------- Gemini ----------

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'

async function generateGemini(turns: LlmTurn[], opts: LlmOptions): Promise<string> {
  let res: Response
  try {
    res = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(opts.model)}:generateContent`, {
      method: 'POST',
      // 返事が来ないまま待ち続けないように、一定時間で打ち切る
      signal: AbortSignal.timeout(APP_DEFAULTS.aiTimeoutMs),
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
      body: JSON.stringify({
        systemInstruction: opts.system ? { parts: [{ text: opts.system }] } : undefined,
        contents: toGeminiContents(turns),
        generationConfig: {
          temperature: opts.temperature ?? 0.8,
          responseMimeType: opts.json ? 'application/json' : 'text/plain',
        },
      }),
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError') throw new Error(TIMEOUT_MESSAGE)
    throw new Error(NETWORK_MESSAGE)
  }
  if (!res.ok) throw await geminiHttpError(res, opts.model)
  const data = await res.json()
  const text: string | undefined = data?.candidates?.[0]?.content?.parts
    ?.filter((p: { thought?: boolean }) => !p.thought)
    .map((p: { text?: string }) => p.text ?? '')
    .join('')
  if (!text) throw new Error('AIから空の応答が返りました。もう一度お試しください。')
  return text
}

async function geminiHttpError(res: Response, model: string): Promise<Error> {
  const body = await res.text()
  if ((res.status === 400 || res.status === 403) && /API key/i.test(body)) {
    return new Error('Gemini のAPIキーが正しくありません。「設定」を確認してください。')
  }
  if (res.status === 404) return new Error(`モデル「${model}」が見つかりません。「設定」の「使えるモデルを確認」で選び直してください。`)
  if (res.status === 429) return new Error('無料枠の利用上限に達しました。少し待ってから再度お試しください。')
  if (res.status === 503) return new Error('Gemini が混み合っています。少し待ってからもう一度押してください。')
  return new Error(`AIの呼び出しに失敗しました（${res.status}）：${body.slice(0, 300)}`)
}

/** Gemini のAPIキーで使えるモデルの一覧（設定画面で選ぶため） */
export async function listGeminiModels(apiKey: string): Promise<string[]> {
  const res = await fetch(`${GEMINI_BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } })
  if (!res.ok) throw new Error(`モデル一覧の取得に失敗しました（${res.status}）`)
  const data = await res.json()
  return (data.models ?? [])
    .filter((m: { supportedGenerationMethods?: string[] }) =>
      m.supportedGenerationMethods?.includes('generateContent'),
    )
    .map((m: { name: string }) => m.name.replace(/^models\//, ''))
}

function parseJson<T>(text: string): T {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  try {
    return JSON.parse(cleaned) as T
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as T
    throw new Error('AIの応答をJSONとして読み取れませんでした。もう一度お試しください。')
  }
}

// ---------- 会話用：返事を少しずつ受け取る（ストリーミング） ----------

/** 返事の途中で、こちらから打ち切ったとき（ユーザーが話し始めたときなど）に投げる */
export class AbortedError extends Error {
  constructor() {
    super('aborted')
  }
}

export interface StreamOptions extends LlmOptions {
  /** model が見つからなかったときに代わりに使うモデル（Gemini の会話用モデル向け） */
  fallbackModel?: string
  /** 返事の文字が届くたびに呼ばれる（届いた分だけ） */
  onText: (delta: string) => void
  signal: AbortSignal
}

/**
 * 商談中の返事用。考える時間を最小にして、届いた文字から順に onText に渡す。
 * 全文を待たずに読み上げを始められるので、体感の待ち時間が短くなる。
 */
export async function generateStream(turns: LlmTurn[], opts: StreamOptions): Promise<string> {
  if (!opts.apiKey) throw new Error('APIキーが設定されていません。「設定」画面で入力してください。')
  return opts.provider === 'claude' ? streamClaude(turns, opts) : streamGemini(turns, opts)
}

async function streamClaude(turns: LlmTurn[], opts: StreamOptions): Promise<string> {
  const client = claudeClient(opts.apiKey)
  const useFallback = FALLBACK_MODELS.includes(opts.model)
  try {
    const stream = client.beta.messages.stream(
      {
        model: opts.model,
        max_tokens: 2000,
        system: opts.system,
        messages: turns.map((t) => ({ role: t.role === 'model' ? 'assistant' : 'user', content: t.text })),
        cache_control: { type: 'ephemeral' },
        output_config: { effort: 'low' },
        ...(useFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { signal: opts.signal },
    )
    stream.on('text', (delta) => opts.onText(delta))
    const res = await stream.finalMessage()
    if (res.stop_reason === 'refusal') {
      throw new Error('AIがこの内容への応答を控えました。言い方を変えてもう一度お試しください。')
    }
    return res.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
  } catch (e) {
    throw claudeError(e)
  }
}

/**
 * Gemini の「考える時間」を減らす設定。モデルの世代で書き方が違うため、
 * 受け付けられなかったら次の書き方を試し、通ったものを覚えておく。
 */
const GEMINI_FAST_THINKING: (Record<string, unknown> | null)[] = [
  { thinkingBudget: 0 },
  { thinkingLevel: 'minimal' },
  { thinkingLevel: 'low' },
  null,
]
/** モデルごとに、受け付けられた書き方の番号を覚えておく */
const geminiThinkingIndex = new Map<string, number>()

/** このキーでは見つからなかったモデル（次からは最初から代わりのモデルを使う） */
const missingGeminiModels = new Set<string>()

/** このキーでは見つからなかったモデル（次からは最初から代わりのモデルを使う） */
const missingGeminiModels = new Set<string>()

async function streamGemini(turns: LlmTurn[], opts: StreamOptions): Promise<string> {
  if (opts.fallbackModel && missingGeminiModels.has(opts.model)) {
    return streamGemini(turns, { ...opts, model: opts.fallbackModel, fallbackModel: undefined })
  }
  for (;;) {
    const index = geminiThinkingIndex.get(opts.model) ?? 0
    const thinking = GEMINI_FAST_THINKING[index]
    let res: Response
    try {
      res = await fetch(
        `${GEMINI_BASE}/models/${encodeURIComponent(opts.model)}:streamGenerateContent?alt=sse`,
        {
          method: 'POST',
          signal: AbortSignal.any([opts.signal, AbortSignal.timeout(APP_DEFAULTS.aiTimeoutMs)]),
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
          body: JSON.stringify({
            systemInstruction: opts.system ? { parts: [{ text: opts.system }] } : undefined,
            contents: toGeminiContents(turns),
            generationConfig: {
              temperature: opts.temperature ?? 0.8,
              ...(thinking ? { thinkingConfig: thinking } : {}),
            },
          }),
        },
      )
    } catch (e) {
      throw fetchError(e, opts.signal)
    }
    // 「考える時間を減らす」設定はモデルによって受け付けられず、理由の書かれていない 400 が返ることがある。
    // そのときは次の書き方（最後は設定なし）でやり直す
    if (res.status === 400 && thinking) {
      const body = await res.text()
      if (/API key/i.test(body)) throw new Error('Gemini のAPIキーが正しくありません。「設定」を確認してください。')
      geminiThinkingIndex.set(opts.model, index + 1)
      continue
    }
    // 設定なしでも受け付けられないなら、会話用のモデルをあきらめて通常のモデルで続ける
    if ((res.status === 400 || res.status === 404) && opts.fallbackModel) {
      // 会話用の速いモデルが使えないキーでは、通常のモデルで続ける
      missingGeminiModels.add(opts.model)
      return streamGemini(turns, { ...opts, model: opts.fallbackModel, fallbackModel: undefined })
    }
    if (res.status === 404 && opts.fallbackModel) {
      // 会話用の速いモデルが使えないキーでは、通常のモデルで続ける
      missingGeminiModels.add(opts.model)
      return streamGemini(turns, { ...opts, model: opts.fallbackModel, fallbackModel: undefined })
    }
    if (!res.ok) throw await geminiHttpError(res, opts.model)
    return readGeminiSse(res, opts)
  }
}

/** 空の発言を除き、同じ話し手が続いたら1つにまとめる（Gemini はどちらも受け付けないことがある） */
function toGeminiContents(turns: LlmTurn[]) {
  const merged: LlmTurn[] = []
  for (const t of turns) {
    if (!t.text.trim()) continue
    const last = merged[merged.length - 1]
    if (last && last.role === t.role) last.text += '\n' + t.text
    else merged.push({ ...t })
  }
  return merged.map((t) => ({ role: t.role, parts: [{ text: t.text }] }))
}

async function readGeminiSse(res: Response, opts: StreamOptions): Promise<string> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  let full = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += value
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const data = JSON.parse(line.slice(5))
        const parts: { text?: string; thought?: boolean }[] = data?.candidates?.[0]?.content?.parts ?? []
        // thought: true は考えている途中のメモなので、返事には含めない
        const delta = parts
          .filter((p) => !p.thought)
          .map((p) => p.text ?? '')
          .join('')
        if (delta) {
          full += delta
          opts.onText(delta)
        }
      }
    }
  } catch (e) {
    throw fetchError(e, opts.signal)
  }
  if (!full) throw new Error('AIから空の応答が返りました。もう一度お試しください。')
  return full
}

function fetchError(e: unknown, signal: AbortSignal): Error {
  if (signal.aborted) return new AbortedError()
  if (e instanceof DOMException && e.name === 'TimeoutError') return new Error(TIMEOUT_MESSAGE)
  return new Error(NETWORK_MESSAGE)
}
