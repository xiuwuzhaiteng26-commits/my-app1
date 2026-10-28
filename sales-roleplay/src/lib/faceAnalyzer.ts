// カメラ映像から目線・表情を計測する（MediaPipe Face Landmarker）
// 映像はブラウザの中だけで処理され、外部には送信されません
import { FaceLandmarker, FilesetResolver, type FaceLandmarkerResult } from '@mediapipe/tasks-vision'
import { FACE_THRESHOLDS, MEDIAPIPE } from '../config/settings'
import { FACE_SCORING } from '../config/rubric'
import type { FaceSample, FaceSummary } from './types'

let landmarkerPromise: Promise<FaceLandmarker> | null = null

export function loadFaceLandmarker(): Promise<FaceLandmarker> {
  landmarkerPromise ??= (async () => {
    const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE.wasmUrl)
    return FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MEDIAPIPE.modelUrl, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
    })
  })()
  return landmarkerPromise
}

export interface FrameReading {
  faceDetected: boolean
  lookingAtCamera: boolean
  smile: number
}

export function readFrame(result: FaceLandmarkerResult): FrameReading {
  const lm = result.faceLandmarks[0]
  const shapes = result.faceBlendshapes[0]?.categories
  if (!lm || !shapes) return { faceDetected: false, lookingAtCamera: false, smile: 0 }

  const score = (name: string) => shapes.find((c) => c.categoryName === name)?.score ?? 0

  // 顔の向き：鼻先(1)が両頬(234, 454)・額(10)・あご(152)の中央からどれだけずれているか
  const nose = lm[1]
  const left = lm[234]
  const right = lm[454]
  const top = lm[10]
  const bottom = lm[152]
  const yaw = (nose.x - (left.x + right.x) / 2) / Math.abs(right.x - left.x || 1)
  const pitch = (nose.y - (top.y + bottom.y) / 2) / Math.abs(bottom.y - top.y || 1)

  // 黒目の向き（どこか一方向に強く寄っていたらカメラを見ていない）
  const eyeLook = Math.max(
    (score('eyeLookOutLeft') + score('eyeLookInRight')) / 2,
    (score('eyeLookInLeft') + score('eyeLookOutRight')) / 2,
    (score('eyeLookUpLeft') + score('eyeLookUpRight')) / 2,
    (score('eyeLookDownLeft') + score('eyeLookDownRight')) / 2,
  )

  const lookingAtCamera =
    Math.abs(yaw) < FACE_THRESHOLDS.headYaw &&
    Math.abs(pitch) < FACE_THRESHOLDS.headPitch &&
    eyeLook < FACE_THRESHOLDS.eyeLook

  const smile = (score('mouthSmileLeft') + score('mouthSmileRight')) / 2
  return { faceDetected: true, lookingAtCamera, smile }
}

export function summarize(samples: FaceSample[]): FaceSummary | null {
  if (samples.length === 0) return null
  const withFace = samples.filter((s) => s.faceDetected)
  const rate = (arr: FaceSample[], f: (s: FaceSample) => boolean) =>
    arr.length ? arr.filter(f).length / arr.length : 0
  const speaking = samples.filter((s) => s.phase === 'user')
  const listening = samples.filter((s) => s.phase === 'ai')
  const smiles = withFace.map((s) => s.smile)
  const avg = smiles.length ? smiles.reduce((a, b) => a + b, 0) / smiles.length : 0
  const sd = smiles.length ? Math.sqrt(smiles.reduce((a, b) => a + (b - avg) ** 2, 0) / smiles.length) : 0

  return {
    sampleCount: samples.length,
    faceDetectedRate: withFace.length / samples.length,
    eyeContactRate: rate(samples, (s) => s.lookingAtCamera),
    eyeContactWhileSpeaking: rate(speaking, (s) => s.lookingAtCamera),
    eyeContactWhileListening: rate(listening, (s) => s.lookingAtCamera),
    smileRate: rate(withFace, (s) => s.smile > FACE_THRESHOLDS.smile),
    averageSmile: avg,
    expressiveness: Math.min(1, sd * 4),
  }
}

/** 計測値を 0〜100点に変換（変換ルールは config/rubric.ts の FACE_SCORING） */
export function faceScores(f: FaceSummary): { eyeContact: number; expression: number } {
  const eyeBase = f.eyeContactWhileSpeaking || f.eyeContactRate
  const eyeContact = Math.round(Math.min(1, eyeBase / FACE_SCORING.eyeContactFullScoreRate) * 100)

  const { smileIdealMin: lo, smileIdealMax: hi } = FACE_SCORING
  let smileScore: number
  if (f.smileRate < lo) smileScore = f.smileRate / lo
  else if (f.smileRate > hi) smileScore = Math.max(0, 1 - (f.smileRate - hi) / (1 - hi))
  else smileScore = 1
  const expression = Math.round((smileScore * 0.7 + f.expressiveness * 0.3) * 100)
  return { eyeContact, expression }
}
