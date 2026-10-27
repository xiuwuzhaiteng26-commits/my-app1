// AI（Gemini API）との通信
// 別のAI（Claudeなど）に切り替えたいときは、このファイルの generate() を差し替えます

export interface LlmTurn {
  role: 'user' | 'model'
  text: string
}

export interface LlmOptions {
  apiKey: string
  model: string
  system?: string
  json?: boolean
  temperature?: number
}

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

export async function generate(turns: LlmTurn[], opts: LlmOptions): Promise<string> {
  if (!opts.apiKey) throw new Error('APIキーが設定されていません。「設定」画面で入力してください。')
  const res = await fetch(`${BASE}/models/${encodeURIComponent(opts.model)}:generateContent`, {
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

export async function generateJson<T>(prompt: string, opts: Omit<LlmOptions, 'json'>): Promise<T> {
  const text = await generate([{ role: 'user', text: prompt }], { ...opts, json: true })
  return parseJson<T>(text)
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

/** APIキーで使えるモデルの一覧（設定画面で選ぶため） */
export async function listModels(apiKey: string): Promise<string[]> {
  const res = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } })
  if (!res.ok) throw new Error(`モデル一覧の取得に失敗しました（${res.status}）`)
  const data = await res.json()
  return (data.models ?? [])
    .filter((m: { supportedGenerationMethods?: string[] }) =>
      m.supportedGenerationMethods?.includes('generateContent'),
    )
    .map((m: { name: string }) => m.name.replace(/^models\//, ''))
}
