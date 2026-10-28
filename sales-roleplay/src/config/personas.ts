// ============================================================
// 商談相手（キャリアセンター職員）の性格と難易度
// ★ 新しいタイプを足したいときは配列に追加するだけで、設定画面の選択肢に出ます
// ============================================================

export interface Persona {
  id: string
  label: string
  /** AIへの演技指示 */
  instruction: string
}

export const PERSONAS: Persona[] = [
  {
    id: 'auto',
    label: 'おまかせ（アポ背景から自動で決める）',
    instruction: 'アポ背景から最も自然な人物像を設定してください。',
  },
  {
    id: 'cooperative',
    label: '協力的・前向き',
    instruction: '話をよく聞き、前向きに質問する。ただし具体性のない説明には「具体的には？」と聞き返す。',
  },
  {
    id: 'cautious',
    label: '慎重・情報収集段階',
    instruction: 'すぐには導入を考えておらず、他社と比較中。根拠や事例を求め、即答を避ける。',
  },
  {
    id: 'busy',
    label: '多忙・早く終わらせたい',
    instruction: '業務が忙しく、話が長いと遮って要点を求める。結論から話さないと不機嫌になる。',
  },
  {
    id: 'budget',
    label: '予算に厳しい',
    instruction: '予算が限られており、費用対効果と価格の話を何度も持ち出す。学内の稟議が厳しい。',
  },
  {
    id: 'veteran',
    label: 'ベテラン・課題意識が高い',
    instruction: 'キャリア支援の経験が長く知識が豊富。業界動向や他大学の取り組みについて鋭い質問をする。',
  },
]

export interface Difficulty {
  id: string
  label: string
  instruction: string
  /** 電話では出ていない悩みの数 */
  unspokenCount: number
  /** そのうち、職員が商談の途中で自分から切り出す数（残りは聞かれたときだけ話す） */
  spontaneousCount: number
}

export const DIFFICULTIES: Difficulty[] = [
  {
    id: 'easy',
    label: 'やさしい',
    instruction: '本当の課題は、営業が1〜2回質問すれば話してくれる。懸念は軽めに1つだけ出す。',
    unspokenCount: 1,
    spontaneousCount: 1,
  },
  {
    id: 'normal',
    label: 'ふつう',
    instruction: '本当の課題は、営業が具体的に深掘りしたときだけ話す。懸念は2つ程度出す。',
    unspokenCount: 2,
    spontaneousCount: 1,
  },
  {
    id: 'hard',
    label: 'むずかしい',
    instruction:
      '本当の課題は、営業が示唆質問（放置するとどうなるか）まで踏み込んだときだけ明かす。懸念や反論を積極的に出し、曖昧な回答には必ず突っ込む。',
    unspokenCount: 3,
    spontaneousCount: 1,
  },
]
