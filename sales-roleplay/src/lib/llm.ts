// AI（Claude または Gemini）との通信
// どちらを使うかは設定画面で選びます。画面側は generate() / generateJson() だけを呼びます
import Anthropic from '@anthropic-ai/sdk'

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
  // APIキーは各自のブラウザにだけ保存されたものを使う（サーバーを置かないため、ブラウザから直接呼ぶ）
  const client = new Anthropic({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true })
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
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Claude のAPIキーが正しくありません。「設定」を確認してください。')
    if (e instanceof Anthropic.RateLimitError) throw new Error('利用上限に達しました。少し待ってから再度お試しください。')
    if (e instanceof Anthropic.APIError) throw new Error(`AIの呼び出しに失敗しました（${e.status}）：${e.message}`)
    throw e
  }
}

// ---------- Gemini ----------

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'

async function generateGemini(turns: LlmTurn[], opts: LlmOptions): Promise<string> {
  const res = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(opts.model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
    body: JSON.stringify({
      systemInstruction: opts.system ? { parts: [{ text: opts.system }] } : undefined,
      contents: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
      generationConfig: {
        temperature: opts.temperature ?? 0.8,
        responseMimeType: opts.json ? 'application/json' : 'text/plain',
      },
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    if (res.status === 429) throw new Error('無料枠の利用上限に達しました。少し待ってから再度お試しください。')
    throw new Error(`AIの呼び出しに失敗しました（${res.status}）：${body.slice(0, 300)}`)
  }
  const data = await res.json()
  const text: string | undefined = data?.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p.text ?? '')
    .join('')
  if (!text) throw new Error('AIから空の応答が返りました。もう一度お試しください。')
  return text
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
