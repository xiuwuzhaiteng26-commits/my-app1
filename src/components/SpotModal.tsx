import { useEffect } from 'react'
import type { TouringSpot } from '../types'

interface Props {
  spot: TouringSpot
  onClose: () => void
}

function SpotModal({ spot, onClose }: Props) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="modal__close" onClick={onClose} aria-label="閉じる">
          ×
        </button>
        <div className="modal__region">{spot.region}・{spot.prefecture}</div>
        <h2 id="modal-title" className="modal__title">{spot.name}</h2>
        <div className="spot-card__meta">
          <span className="badge badge--difficulty">{spot.difficulty}</span>
          <span className="badge">{spot.distanceKm}km</span>
          <span className="badge">{spot.duration}</span>
          <span className="badge">{spot.bestSeasons.join('・')}がおすすめ</span>
        </div>
        <p className="modal__summary">{spot.summary}</p>

        <h3 className="modal__subhead">見どころ</h3>
        <ul className="modal__list">
          {spot.highlights.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>

        <h3 className="modal__subhead">ツーリングTips</h3>
        <p className="modal__tip">{spot.tip}</p>
      </div>
    </div>
  )
}

export default SpotModal
