// 商談相手のアバター（SVG）。話している間は口が動き、ときどきまばたきします
// 見た目を変えたいときは、色（COLORS）や図形を編集してください

const COLORS = {
  skin: '#f3d2b8',
  hair: '#2f2a28',
  suit: '#34445c',
  shirt: '#ffffff',
  tie: '#7a8fb3',
  background: '#cfd8e3',
}

interface Props {
  speaking: boolean
  thinking: boolean
  name: string
}

export default function Avatar({ speaking, thinking, name }: Props) {
  return (
    <div className="tile avatar-tile">
      <svg viewBox="0 0 320 240" className="avatar-svg" role="img" aria-label={`${name}のアバター`}>
        <rect width="320" height="240" fill={COLORS.background} />
        {/* 本棚風の背景 */}
        <rect x="20" y="30" width="80" height="120" fill="#b9c5d3" rx="4" />
        <rect x="230" y="40" width="70" height="90" fill="#b9c5d3" rx="4" />
        {/* 体 */}
        <path d="M70 240 Q80 175 160 170 Q240 175 250 240 Z" fill={COLORS.suit} />
        <path d="M135 172 L160 215 L185 172 Z" fill={COLORS.shirt} />
        <path d="M155 180 L165 180 L168 215 L160 225 L152 215 Z" fill={COLORS.tie} />
        {/* 首・顔 */}
        <rect x="145" y="140" width="30" height="35" fill={COLORS.skin} />
        <ellipse cx="160" cy="105" rx="45" ry="52" fill={COLORS.skin} />
        {/* 髪 */}
        <path d="M115 100 Q112 50 160 48 Q208 50 205 100 Q200 70 160 68 Q120 70 115 100 Z" fill={COLORS.hair} />
        {/* 眉 */}
        <g className={thinking ? 'brow-think' : ''}>
          <rect x="133" y="88" width="16" height="3" rx="1.5" fill={COLORS.hair} />
          <rect x="171" y="88" width="16" height="3" rx="1.5" fill={COLORS.hair} />
        </g>
        {/* 目 */}
        <g className="eyes">
          <ellipse cx="141" cy="102" rx="4" ry="5" fill="#222" />
          <ellipse cx="179" cy="102" rx="4" ry="5" fill="#222" />
        </g>
        {/* メガネ */}
        <g fill="none" stroke="#555" strokeWidth="2">
          <rect x="128" y="92" width="26" height="20" rx="6" />
          <rect x="166" y="92" width="26" height="20" rx="6" />
          <line x1="154" y1="101" x2="166" y2="101" />
        </g>
        {/* 口 */}
        <ellipse cx="160" cy="135" rx="10" ry="3" fill="#a5544c" className={speaking ? 'mouth talking' : 'mouth'} />
      </svg>
      <div className="tile-label">
        {name}
        {thinking && <span className="badge">考え中…</span>}
        {speaking && <span className="badge speaking">話しています</span>}
      </div>
    </div>
  )
}
