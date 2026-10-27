import { useEffect, useState } from 'react'
import { listModels } from '../lib/llm'
import { getJapaneseVoices, speak } from '../lib/speech'
import { exportKnowledge, importKnowledge, type AppSettings } from '../lib/storage'
import { KNOWLEDGE_FIELDS } from '../config/knowledge'
import { APP_DEFAULTS } from '../config/settings'

interface Props {
  settings: AppSettings
  onSave: (s: AppSettings) => void
}

export default function SettingsPage({ settings, onSave }: Props) {
  const [draft, setDraft] = useState(settings)
  const [models, setModels] = useState<string[]>([])
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [message, setMessage] = useState('')

  useEffect(() => {
    const update = () => setVoices(getJapaneseVoices())
    update()
    speechSynthesis.addEventListener('voiceschanged', update)
    return () => speechSynthesis.removeEventListener('voiceschanged', update)
  }, [])

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => setDraft({ ...draft, [key]: value })

  const fetchModels = async () => {
    try {
      setModels(await listModels(draft.apiKey))
      setMessage('モデル一覧を取得しました（APIキーは有効です）')
    } catch (e) {
      setMessage((e as Error).message)
    }
  }

  return (
    <div className="page">
      <h2>設定</h2>

      <section className="card">
        <h3>AI（Gemini API）</h3>
        <p className="hint">
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
            Google AI Studio
          </a>
          で無料のAPIキーを発行して貼り付けてください。キーはこのブラウザの中にだけ保存されます。
        </p>
        <label>
          APIキー
          <input type="password" value={draft.apiKey} onChange={(e) => set('apiKey', e.target.value.trim())} />
        </label>
        <label>
          モデル
          <div className="row">
            <input list="models" value={draft.model} onChange={(e) => set('model', e.target.value)} />
            <button type="button" onClick={fetchModels} disabled={!draft.apiKey}>
              使えるモデルを確認
            </button>
          </div>
          <datalist id="models">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <p className="hint">初期値は {APP_DEFAULTS.model}（無料枠で使えるFlash系の最新版）です。</p>
      </section>

      <section className="card">
        <h3>AIの声</h3>
        <div className="row">
          <select value={draft.ttsVoice} onChange={(e) => set('ttsVoice', e.target.value)}>
            <option value="">自動</option>
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => speak('本日はよろしくお願いいたします。', { voiceName: draft.ttsVoice, rate: APP_DEFAULTS.ttsRate })}>
            試しに聞く
          </button>
        </div>
      </section>

      <section className="card">
        <h3>社内の情報</h3>
        <p className="hint">
          ここに入力した内容はこのブラウザの中にだけ保存され、インターネット上には公開されません。
          ほかの人に渡すときは「ファイルに書き出す」で作ったファイルを社内で直接渡し、相手は「ファイルから読み込む」で取り込みます（APIキーは書き出されません）。
        </p>
        <div className="row">
          <button type="button" onClick={() => exportKnowledge(draft)}>
            ファイルに書き出す
          </button>
          <label className="file-button">
            ファイルから読み込む
            <input
              type="file"
              accept="application/json,.json"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                try {
                  setDraft({ ...draft, ...(await importKnowledge(file)) })
                  setMessage('読み込みました。「保存する」を押すと反映されます')
                } catch {
                  setMessage('ファイルを読み込めませんでした')
                }
              }}
            />
          </label>
        </div>
        {KNOWLEDGE_FIELDS.map((f) => (
          <label key={f.key}>
            {f.label}
            <span className="hint field-hint">{f.hint}</span>
            {f.rows === 1 ? (
              <input value={draft[f.key]} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
            ) : (
              <textarea
                rows={f.rows}
                value={draft[f.key]}
                placeholder={f.placeholder}
                onChange={(e) => set(f.key, e.target.value)}
              />
            )}
          </label>
        ))}
      </section>

      <div className="row">
        <button
          className="primary"
          onClick={() => {
            onSave(draft)
            setMessage('保存しました')
          }}
        >
          保存する
        </button>
        {message && <span className="hint">{message}</span>}
      </div>
    </div>
  )
}
