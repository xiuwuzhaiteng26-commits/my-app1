// ============================================================
// アプリの基本設定
// ============================================================

export const APP_DEFAULTS = {
  /** 使うAI。設定画面から変更できます */
  provider: 'gemini' as 'claude' | 'gemini',
  /** Claude のモデル。設定画面から変更できます */
  claudeModel: 'claude-opus-5-5',
  /** Google AI Studio の無料枠で使えるモデル */
  model: 'gemini-flash-latest',
  /** 商談時間の上限（分） */
  maxMinutesLimit: 60,
  defaultMinutes: 30,
  /** 終了何分前にAIが時間を気にし始めるか */
  wrapUpWarningMinutes: 5,
  /** 音声認識の言語 */
  speechLang: 'ja-JP',
  /**
   * 話し終わってから自動送信するまでの無音時間（ミリ秒）。
   * 短いほど返事が早くなるが、話の途中の「間」で送られやすくなる
   */
  autoSendSilenceMs: 700,
  /** AIが話している途中でも、こちらが話し始めたらAIの声を止める */
  bargeIn: true,
  /** 読み上げの速さ（1が標準） */
  ttsRate: 1.1,
  /** AIの返事をこの時間（ミリ秒）待っても来なければ、あきらめてエラーを表示する */
  aiTimeoutMs: 90000,
}

// 設定画面で選べる Claude のモデル（料金は 100万トークンあたりの入力 / 出力）
export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5（最も賢い・$4 / $20）' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5（バランス型・$2 / $10）' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5（最も安く速い・$0.10 / $0.50）' },
]

// MediaPipe（顔認識）の読み込み先。プログラム本体は npm run dev / build のときに public/mediapipe にコピーされます
export const MEDIAPIPE = {
  wasmUrl: `${import.meta.env.BASE_URL}mediapipe`,
  modelUrl:
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  /** 何ミリ秒ごとに顔を分析するか */
  sampleIntervalMs: 500,
}

// 目線・表情の判定のしきい値（判定が厳しすぎる／甘すぎるときに調整）
export const FACE_THRESHOLDS = {
  /** 黒目がこれ以上どこかの方向を向いていたら「カメラを見ていない」 */
  eyeLook: 0.45,
  /** 顔の左右の向き（0が正面）。これを超えたら横を向いている */
  headYaw: 0.18,
  /** 顔の上下の向き（0が正面） */
  headPitch: 0.15,
  /** 笑顔とみなす値 */
  smile: 0.35,
}
