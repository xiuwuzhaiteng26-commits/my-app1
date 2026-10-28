// 自分のカメラ映像の表示と、目線・表情の計測
import { useEffect, useRef, useState } from 'react'
import { loadFaceLandmarker, readFrame, type FrameReading } from '../lib/faceAnalyzer'
import { MEDIAPIPE } from '../config/settings'
import type { FaceSample } from '../lib/types'

interface Props {
  /** 計測を記録するかどうか（商談中だけ true） */
  recording: boolean
  getPhase: () => FaceSample['phase']
  getElapsed: () => number
  onSample: (s: FaceSample) => void
}

const CAMERA_KEY = 'sales-roleplay:camera'

/** 映像の明るさがこれ未満の状態が続いたら「真っ黒」とみなす（0〜255） */
const DARK_LEVEL = 12
/** 真っ黒が何回続いたら案内を出すか（sampleIntervalMs ごとに数える） */
const DARK_COUNT = 6

const BLACK_HELP =
  'カメラの映像が真っ黒です。①Teams・Zoomなどカメラを使うアプリを閉じる ②ノートPCのカメラのふた・カメラ停止キーを確認する ③下の一覧で別のカメラを選ぶ ④Windowsの「設定 → プライバシーとセキュリティ → カメラ」でブラウザを許可する、を試してください。'

export default function CameraView({ recording, getPhase, getElapsed, onSample }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState('カメラを準備中…')
  const [reading, setReading] = useState<FrameReading | null>(null)
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState(() => {
    try {
      return localStorage.getItem(CAMERA_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const recordingRef = useRef(recording)
  const cbRef = useRef({ getPhase, getElapsed, onSample })
  useEffect(() => {
    recordingRef.current = recording
    cbRef.current = { getPhase, getElapsed, onSample }
  })

  useEffect(() => {
    let stream: MediaStream | null = null
    let timer: number | undefined
    let cancelled = false
    // 明るさを測るための小さな画像
    const probe = document.createElement('canvas')
    probe.width = 32
    probe.height = 24
    const probeCtx = probe.getContext('2d', { willReadFrequently: true })
    let darkCount = 0

    ;(async () => {
      try {
        setStatus('カメラを準備中…')
        stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId }, width: 640, height: 480 } : { width: 640, height: 480 },
          audio: false,
        })
        if (cancelled || !videoRef.current) return
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        // 許可をもらった後は、カメラの名前まで取れる
        const devices = await navigator.mediaDevices.enumerateDevices()
        if (!cancelled) setCameras(devices.filter((d) => d.kind === 'videoinput'))
      } catch (e) {
        // 前に選んだカメラが外されていたら、自動選択に戻してやり直す
        if (deviceId && e instanceof DOMException && e.name === 'OverconstrainedError') {
          if (!cancelled) setDeviceId('')
          return
        }
        setStatus(`カメラを使えません：${cameraErrorText(e)}（目線・表情は評価されません）`)
        return
      }
      try {
        setStatus('顔認識モデルを読み込み中…')
        const landmarker = await loadFaceLandmarker()
        if (cancelled) return
        setStatus('')
        timer = window.setInterval(() => {
          const v = videoRef.current
          if (!v || v.readyState < 2) return
          if (probeCtx) {
            probeCtx.drawImage(v, 0, 0, probe.width, probe.height)
            const px = probeCtx.getImageData(0, 0, probe.width, probe.height).data
            let sum = 0
            for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2]
            darkCount = sum / (px.length / 4) / 3 < DARK_LEVEL ? darkCount + 1 : 0
            setStatus(darkCount >= DARK_COUNT ? BLACK_HELP : '')
          }
          const r = readFrame(landmarker.detectForVideo(v, performance.now()))
          setReading(r)
          if (recordingRef.current) {
            const { getPhase, getElapsed, onSample } = cbRef.current
            onSample({ t: getElapsed(), phase: getPhase(), ...r })
          }
        }, MEDIAPIPE.sampleIntervalMs)
      } catch (e) {
        setStatus(`顔認識を読み込めませんでした：${errorText(e)}（目線・表情は評価されません）`)
      }
    })()

    return () => {
      cancelled = true
      window.clearInterval(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [deviceId])

  const chooseCamera = (id: string) => {
    try {
      localStorage.setItem(CAMERA_KEY, id)
    } catch {
      // 保存できなくても、この画面では切り替える
    }
    setDeviceId(id)
  }

  return (
    <div className="camera-wrap">
      <div className="tile camera-tile">
        <video ref={videoRef} muted playsInline className="camera-video" />
        {status && <div className="tile-overlay">{status}</div>}
        <div className="tile-label">
          あなた
          {reading && !status && (
            <>
              <span className={`badge ${reading.lookingAtCamera ? 'ok' : 'warn'}`}>
                {!reading.faceDetected ? '顔が映っていません' : reading.lookingAtCamera ? 'カメラ目線' : '目線がずれています'}
              </span>
              {reading.smile > 0.35 && <span className="badge ok">笑顔</span>}
            </>
          )}
        </div>
      </div>
      {cameras.length > 1 && (
        <label className="camera-select">
          使うカメラ
          <select value={deviceId} onChange={(e) => chooseCamera(e.target.value)}>
            <option value="">自動</option>
            {cameras.map((c, i) => (
              <option key={c.deviceId} value={c.deviceId}>
                {c.label || `カメラ ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** よくあるカメラのエラーを、何をすればいいか分かる言葉にする */
function cameraErrorText(e: unknown): string {
  const name = e instanceof DOMException ? e.name : ''
  if (name === 'NotAllowedError') return 'カメラの使用が許可されていません。アドレスバー左のカギのマークからカメラを「許可」にしてください'
  if (name === 'NotFoundError') return 'カメラが見つかりません'
  if (name === 'NotReadableError') return 'カメラをほかのアプリが使っています。Teams・Zoomなどを閉じてから再読み込みしてください'
  return errorText(e)
}
