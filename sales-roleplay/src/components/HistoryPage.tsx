import type { SessionRecord } from '../lib/types'

interface Props {
  history: SessionRecord[]
  onOpen: (r: SessionRecord) => void
  onDelete: (id: string) => void
}

export default function HistoryPage({ history, onOpen, onDelete }: Props) {
  return (
    <div className="page">
      <h2>練習の履歴</h2>
      {history.length === 0 && <p className="hint">まだ練習の記録がありません。</p>}
      {history.map((h) => (
        <div key={h.id} className="card history-item">
          <div>
            <strong>{h.scenario.universityName}</strong>（{h.scenario.contactRole}）
            <div className="hint">
              {new Date(h.startedAt).toLocaleString('ja-JP')}／{Math.round(h.durationSec / 60)}分
            </div>
          </div>
          <span className="score big">{h.evaluation ? `${h.evaluation.totalScore}点` : '未評価'}</span>
          <div className="row">
            <button onClick={() => onOpen(h)}>見る</button>
            <button
              className="danger"
              onClick={() => {
                if (confirm('この記録を削除しますか？')) onDelete(h.id)
              }}
            >
              削除
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
