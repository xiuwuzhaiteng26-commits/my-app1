import { useState } from 'react'
import { DIFFICULTIES, PERSONAS } from '../config/personas'
import { APP_DEFAULTS } from '../config/settings'
import { buildScenarioPrompt } from '../config/prompts'
import { generateJson } from '../lib/llm'
import type { AppSettings } from '../lib/storage'
import { normalizeIssues, type Scenario, type SessionSetup } from '../lib/types'
import { parseSamples } from '../config/knowledge'

interface Props {
  settings: AppSettings
  onStart: (setup: SessionSetup, scenario: Scenario) => void
}

const EXAMPLE = `例）
・私立大学、学生数 約8,000人
・電話口はキャリアセンターの担当職員。課長も同席予定
・「低学年向けのキャリア支援をどうするか検討中」とのことで、資料を見ながら話を聞きたい
・他社サービスも1社検討しているらしい`

export default function SetupPage({ settings, onStart }: Props) {
  const [setup, setSetup] = useState<SessionSetup>({
    appointmentBackground: '',
    personaId: 'auto',
    difficultyId: 'normal',
    maxMinutes: APP_DEFAULTS.defaultMinutes,
  })
  const [scenario, setScenario] = useState<Scenario | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const samples = parseSamples(settings.sampleBackgrounds)

  const create = async () => {
    setLoading(true)
    setError('')
    try {
      const s = await generateJson<Scenario>(buildScenarioPrompt(setup, settings), {
        apiKey: settings.apiKey,
        model: settings.model,
        temperature: 1,
      })
      setScenario(s)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <h2>商談の準備</h2>
      <section className="card">
        {samples.length > 0 && (
          <div className="row samples">
            <span className="hint">サンプル：</span>
            {samples.map((s) => (
              <button key={s.label} type="button" onClick={() => setSetup({ ...setup, appointmentBackground: s.text })}>
                {s.label}
              </button>
            ))}
          </div>
        )}
        <label>
          テレアポで取得したアポの背景
          <textarea
            rows={8}
            placeholder={EXAMPLE}
            value={setup.appointmentBackground}
            onChange={(e) => setSetup({ ...setup, appointmentBackground: e.target.value })}
          />
        </label>
        <div className="grid2">
          <label>
            相手のタイプ
            <select value={setup.personaId} onChange={(e) => setSetup({ ...setup, personaId: e.target.value })}>
              {PERSONAS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            難易度
            <select value={setup.difficultyId} onChange={(e) => setSetup({ ...setup, difficultyId: e.target.value })}>
              {DIFFICULTIES.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          予定時間：{setup.maxMinutes}分（相手が必要な情報を得られれば早く終わることもあります）
          <input
            type="range"
            min={10}
            max={APP_DEFAULTS.maxMinutesLimit}
            step={5}
            value={setup.maxMinutes}
            onChange={(e) => setSetup({ ...setup, maxMinutes: Number(e.target.value) })}
          />
        </label>
        <button className="primary" onClick={create} disabled={loading || !settings.apiKey}>
          {loading ? 'シナリオを作成中…' : scenario ? 'シナリオを作り直す' : 'シナリオを作成'}
        </button>
        {!settings.apiKey && <p className="error">先に「設定」でAPIキーを入力してください。</p>}
        {error && <p className="error">{error}</p>}
      </section>

      {scenario && (
        <section className="card">
          <h3>今回の商談相手</h3>
          <dl className="facts">
            <dt>大学</dt>
            <dd>
              {scenario.universityName}：{scenario.universityProfile}
            </dd>
            <dt>担当者</dt>
            <dd>
              {scenario.contactRole} {scenario.contactName}
            </dd>
            <dt>アポの理由</dt>
            <dd>{scenario.surfaceReason}</dd>
            {scenario.phoneStatedNeeds && scenario.phoneStatedNeeds.length > 0 && (
              <>
                <dt>電話で聞いていた関心ごと</dt>
                <dd>
                  <ul>{scenario.phoneStatedNeeds.map((n) => <li key={n}>{n}</li>)}</ul>
                </dd>
              </>
            )}
          </dl>
          <details>
            <summary>相手の本音・質問予定を見る（ネタバレ。練習前は見ないのがおすすめ）</summary>
            <h4>電話では言っていない悩み</h4>
            <ul>
              {normalizeIssues(scenario).map((i) => (
                <li key={i.issue}>
                  {i.issue}
                  <span className="hint">
                    （{i.kind === 'deeper' ? '電話で言ったことの奥にある理由' : '電話では言っていない別の悩み'}／
                    {i.reveal === 'spontaneous' ? '途中で自分から切り出す' : '聞かれたら話す'}
                    {i.trigger && `／きっかけ：${i.trigger}`}）
                  </span>
                </li>
              ))}
            </ul>
            <h4>懸念</h4>
            <ul>{scenario.concerns.map((i) => <li key={i}>{i}</li>)}</ul>
            <h4>予定している質問</h4>
            <ul>{scenario.questionsToAsk.map((i) => <li key={i}>{i}</li>)}</ul>
            <h4>予算・決裁</h4>
            <p>{scenario.decisionContext}</p>
          </details>
          <p className="hint">商談はマイクで話して進めます。カメラとマイクの使用を許可してください。</p>
          <button className="primary" onClick={() => onStart(setup, scenario)}>
            商談を始める
          </button>
        </section>
      )}
    </div>
  )
}
