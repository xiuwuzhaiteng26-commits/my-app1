import { useEffect, useRef, useState } from 'react'
import { RUBRIC } from '../config/rubric'
import { evaluateSession } from '../lib/evaluate'
import { llmConfig, type AppSettings } from '../lib/storage'
import type { SessionRecord } from '../lib/types'

interface Props {
  record: SessionRecord
  settings: AppSettings
  onUpdate: (r: SessionRecord) => void
  onRetry: () => void
}

export default function ResultPage({ record, settings, onUpdate, onRetry }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const ev = record.evaluation

  const run = async () => {
    setLoading(true)
    setError('')
    try {
      const evaluation = await evaluateSession(record.scenario, record.messages, record.face, settings, llmConfig(settings))
      onUpdate({ ...record, evaluation })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  // 初回表示時だけ自動で評価する（開発時の二重実行で無料枠を無駄にしないようにする）
  const autoRan = useRef(false)
  useEffect(() => {
    if (autoRan.current) return
    autoRan.current = true
    if (!record.evaluation && record.messages.some((m) => m.role === 'user')) void run()
  }, [record.id])

  return (
    <div className="page">
      <h2>商談の評価</h2>
      <p className="hint">
        {new Date(record.startedAt).toLocaleString('ja-JP')}／{record.scenario.universityName}／
        {Math.round(record.durationSec / 60)}分
      </p>

      {loading && <div className="card center">AIが商談を評価しています…（30秒ほどかかります）</div>}
      {error && (
        <div className="card">
          <p className="error">{error}</p>
          <button onClick={run}>もう一度評価する</button>
        </div>
      )}
      {!ev && !loading && !error && <div className="card">発言がないため評価できません。</div>}

      {ev && (
        <>
          <section className="card score-card">
            <div className="total">
              <span className="total-num">{ev.totalScore}</span>
              <span>/ 100点</span>
            </div>
            <p>{ev.summary}</p>
          </section>

          <section className="card">
            <h3>項目別の評価</h3>
            {ev.criteria.map((c) => {
              const def = RUBRIC.find((r) => r.id === c.id)
              return (
                <div key={c.id} className="criterion">
                  <div className="criterion-head">
                    <strong>{def?.name ?? c.id}</strong>
                    <span className="weight">重み {def?.weight}</span>
                    <span className="score">{c.score}点</span>
                  </div>
                  <div className="bar">
                    <div className="fill" style={{ width: `${c.score}%` }} />
                  </div>
                  <p>{c.comment}</p>
                  {c.goodPoints.length > 0 && (
                    <ul className="good">{c.goodPoints.map((g) => <li key={g}>{g}</li>)}</ul>
                  )}
                  {c.improvements.length > 0 && (
                    <ul className="improve">{c.improvements.map((g) => <li key={g}>{g}</li>)}</ul>
                  )}
                </div>
              )
            })}
          </section>

          <section className="card">
            <h3>電話では言っていなかった悩み</h3>
            {ev.hiddenIssueDiscovery.map((h) => (
              <div key={h.issue} className="issue">
                <span className={h.discovered ? 'badge ok' : 'badge warn'}>{h.discovered ? '話題に出た' : '出てこなかった'}</span>
                {h.handling && h.handling !== 'not_surfaced' && (
                  <span className={h.handling === 'good' ? 'badge ok' : 'badge warn'}>対応：{HANDLING[h.handling]}</span>
                )}
                <strong>{h.issue}</strong>
                <p>{h.note}</p>
              </div>
            ))}
          </section>

          <section className="card">
            <h3>質問への回答</h3>
            {ev.questionReviews.map((q, i) => (
              <div key={i} className="qa">
                <p>
                  <strong>Q.</strong> {q.question}
                </p>
                <p>
                  <strong>あなた：</strong>
                  {q.answer} <span className="score">{q.score}点</span>
                </p>
                <p>{q.comment}</p>
                <p className="better">
                  <strong>回答例：</strong>
                  {q.betterAnswer}
                </p>
              </div>
            ))}
          </section>

          {record.face && (
            <section className="card">
              <h3>目線・表情の計測値</h3>
              <ul>
                <li>顔が映っていた割合：{pct(record.face.faceDetectedRate)}</li>
                <li>話している間のカメラ目線率：{pct(record.face.eyeContactWhileSpeaking)}</li>
                <li>聞いている間のカメラ目線率：{pct(record.face.eyeContactWhileListening)}</li>
                <li>笑顔の割合：{pct(record.face.smileRate)}</li>
              </ul>
              <p className="hint">カメラの位置や照明で数値はぶれます。参考値として見てください。</p>
            </section>
          )}

          <section className="card">
            <h3>次の練習で意識すること</h3>
            <ol>{ev.nextPracticeTips.map((t) => <li key={t}>{t}</li>)}</ol>
          </section>
        </>
      )}

      <section className="card">
        <details>
          <summary>会話の記録</summary>
          {record.messages.map((m, i) => (
            <p key={i}>
              <strong>{m.role === 'user' ? 'あなた' : record.scenario.contactName}：</strong>
              {m.text}
            </p>
          ))}
        </details>
        <details>
          <summary>相手の設定（本当の課題など）</summary>
          <pre className="pre">{JSON.stringify(record.scenario, null, 2)}</pre>
        </details>
      </section>

      <div className="row">
        <button className="primary" onClick={onRetry}>
          新しい商談を練習する
        </button>
        {ev && <button onClick={run} disabled={loading}>評価をやり直す</button>}
      </div>
    </div>
  )
}

const HANDLING = { good: '良い', partial: '一部できた', poor: '不十分' }

function pct(v: number): string {
  return `${Math.round(v * 100)}%`
}
