// アプリ全体で使う型の定義

/** 会話の1発言 */
export interface ChatMessage {
  role: 'user' | 'ai'
  text: string
  /** 商談開始からの経過秒数 */
  at: number
}

/** テレアポ背景からAIが作る「今回の商談の設定」 */
export interface Scenario {
  universityName: string
  universityProfile: string
  contactName: string
  contactRole: string
  contactPersonality: string
  /** アポを受けた表向きの理由 */
  surfaceReason: string
  /** 電話で相手が口にしていた関心ごと（アポ背景に書かれている内容） */
  phoneStatedNeeds?: string[]
  /** 電話では言っていない悩み。商談の中で出てくる */
  hiddenIssues: (HiddenIssue | string)[]
  /** 導入をためらう理由・懸念 */
  concerns: string[]
  /** AIが商談中に営業へ投げかける質問（サービス外の話題も含む） */
  questionsToAsk: string[]
  /** 予算・決裁者・導入時期などの状況 */
  decisionContext: string
  /** 商談の冒頭でAIが言う最初のひとこと */
  openingLine: string
}

/** 電話では言っていない悩み */
export interface HiddenIssue {
  issue: string
  /** deeper: 電話で言ったことの奥にある本当の理由 / unspoken: 電話では一切出ていない別の悩み */
  kind: 'deeper' | 'unspoken'
  /** spontaneous: 商談の途中で職員が自分から切り出す / asked: 営業が関連する質問をしたときだけ話す */
  reveal: 'spontaneous' | 'asked'
  /** どんなきっかけで話すか */
  trigger: string
}

/** 古い履歴（悩みが文字列だけだった頃）も同じ形で扱えるようにする */
export function normalizeIssues(s: Scenario): HiddenIssue[] {
  return s.hiddenIssues.map((i) =>
    typeof i === 'string' ? { issue: i, kind: 'deeper', reveal: 'asked', trigger: '' } : i,
  )
}

/** 設定画面で入力する社内の知識（ブラウザ内にだけ保存し、リポジトリには置かない） */
export interface Knowledge {
  serviceInfo: string
  universityInfo: string
  contactRole: string
  currentSituation: string
  /** 以下は1行に1つ */
  serviceFacts: string
  differentiators: string
  realWorries: string
  mustAskQuestions: string
  closingGoal: string
  sampleBackgrounds: string
}

/** 商談の設定画面で選ぶ項目 */
export interface SessionSetup {
  appointmentBackground: string
  personaId: string
  difficultyId: string
  maxMinutes: number
}

/** 顔分析の1サンプル（約0.5秒ごと） */
export interface FaceSample {
  t: number
  faceDetected: boolean
  lookingAtCamera: boolean
  smile: number
  /** そのとき誰が話していたか */
  phase: 'user' | 'ai' | 'idle'
}

export interface FaceSummary {
  sampleCount: number
  faceDetectedRate: number
  /** 全体のカメラ目線率 */
  eyeContactRate: number
  /** 自分が話している間のカメラ目線率 */
  eyeContactWhileSpeaking: number
  /** 相手が話している間のカメラ目線率 */
  eyeContactWhileListening: number
  smileRate: number
  averageSmile: number
  /** 表情の変化量（0〜1） */
  expressiveness: number
}

export interface CriterionResult {
  id: string
  score: number
  comment: string
  goodPoints: string[]
  improvements: string[]
}

export interface QuestionReview {
  question: string
  answer: string
  score: number
  comment: string
  betterAnswer: string
}

export interface Evaluation {
  totalScore: number
  summary: string
  criteria: CriterionResult[]
  questionReviews: QuestionReview[]
  /** AIが用意した本当の課題を営業が引き出せたか */
  hiddenIssueDiscovery: {
    issue: string
    /** 商談の中でその悩みが話題に出たか */
    discovered: boolean
    /** 出てきた悩みへの営業の対応 */
    handling?: 'good' | 'partial' | 'poor' | 'not_surfaced'
    note: string
  }[]
  nextPracticeTips: string[]
}

/** 保存される1回分の商談記録 */
export interface SessionRecord {
  id: string
  startedAt: string
  durationSec: number
  setup: SessionSetup
  scenario: Scenario
  messages: ChatMessage[]
  face: FaceSummary | null
  evaluation: Evaluation | null
}
