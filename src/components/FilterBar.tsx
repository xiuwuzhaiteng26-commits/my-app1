import type { Region } from '../types'

interface Props {
  search: string
  onSearchChange: (v: string) => void
  region: Region | 'すべて'
  onRegionChange: (v: Region | 'すべて') => void
  resultCount: number
}

const REGIONS: (Region | 'すべて')[] = [
  'すべて',
  '北海道',
  '東北',
  '関東',
  '中部',
  '関西',
  '中国・四国',
  '九州・沖縄',
]

function FilterBar({ search, onSearchChange, region, onRegionChange, resultCount }: Props) {
  return (
    <div className="filter-bar">
      <input
        type="text"
        className="filter-bar__search"
        placeholder="スポット名・県名で検索"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      <select
        className="filter-bar__select"
        value={region}
        onChange={(e) => onRegionChange(e.target.value as Region | 'すべて')}
      >
        {REGIONS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <span className="filter-bar__count">{resultCount}件のスポット</span>
    </div>
  )
}

export default FilterBar
