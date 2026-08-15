export type Region =
  | '北海道'
  | '東北'
  | '関東'
  | '中部'
  | '関西'
  | '中国・四国'
  | '九州・沖縄'

export type Difficulty = '初級' | '中級' | '上級'

export type Scenery = '海岸' | '山岳' | '湖' | '高原' | '渓谷' | '桜' | '紅葉' | '田園' | '離島'

export type Season = '春' | '夏' | '秋' | '冬'

export type Duration = '日帰り' | '1泊2日' | '2泊3日以上'

export interface TouringSpot {
  id: string
  name: string
  prefecture: string
  region: Region
  distanceKm: number
  difficulty: Difficulty
  duration: Duration
  scenery: Scenery[]
  bestSeasons: Season[]
  summary: string
  highlights: string[]
  tip: string
}

export interface QuizAnswers {
  difficulty: Difficulty | null
  scenery: Scenery | null
  season: Season | null
  duration: Duration | null
}
