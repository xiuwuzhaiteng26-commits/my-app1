import type { TouringSpot } from '../types'

interface Props {
  spot: TouringSpot
  onSelect: (spot: TouringSpot) => void
  highlight?: boolean
}

function SpotCard({ spot, onSelect, highlight }: Props) {
  return (
    <button
      type="button"
      className={`spot-card${highlight ? ' spot-card--highlight' : ''}`}
      onClick={() => onSelect(spot)}
    >
      <div className="spot-card__region">{spot.region}</div>
      <h3 className="spot-card__name">{spot.name}</h3>
      <p className="spot-card__prefecture">{spot.prefecture}</p>
      <div className="spot-card__meta">
        <span className="badge badge--difficulty">{spot.difficulty}</span>
        <span className="badge">{spot.distanceKm}km</span>
        <span className="badge">{spot.duration}</span>
      </div>
      <p className="spot-card__summary">{spot.summary}</p>
      <div className="spot-card__tags">
        {spot.scenery.map((s) => (
          <span key={s} className="tag">
            #{s}
          </span>
        ))}
      </div>
    </button>
  )
}

export default SpotCard
