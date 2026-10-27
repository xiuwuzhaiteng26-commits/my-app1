// ============================================================
// アプリの基本設定
// ============================================================

export const APP_DEFAULTS = {
  /** Google AI Studio の無料枠で使えるモデル。設定画面から変更できます */
  model: 'gemini-flash-latest',
  /** 商談時間の上限（分） */
  maxMinutesLimit: 60,
  defaultMinutes: 30,
  /** 終了何分前にAIが時間を気にし始めるか */
  wrapUpWarningMinutes: 5,
  /** 音声認識の言語 */
  speechLang: 'ja-JP',
  /** 話し終わってから自動送信するまでの無音時間（ミリ秒） */
  autoSendSilenceMs: 1800,
  /** 読み上げの速さ（1が標準） */
  ttsRate: 1.1,
}

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
