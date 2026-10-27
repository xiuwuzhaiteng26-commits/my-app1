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

export default function CameraView({ recording, getPhase, getElapsed, onSample }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState('カメラを準備中…')
  const [reading, setReading] = useState<FrameReading | null>(null)
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

    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false })
        if (cancelled || !videoRef.current) return
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      } catch (e) {
        setStatus(`カメラを使えません：${errorText(e)}（目線・表情は評価されません）`)
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
  }, [])

  return (
    <div className="tile camera-tile">
      <video ref={videoRef} muted playsInline className="camera-video" />
      {status && <div className="tile-overlay">{status}</div>}
      <div className="tile-label">
        あなた
        {reading && (
          <>
            <span className={`badge ${reading.lookingAtCamera ? 'ok' : 'warn'}`}>
              {!reading.faceDetected ? '顔が映っていません' : reading.lookingAtCamera ? 'カメラ目線' : '目線がずれています'}
            </span>
            {reading.smile > 0.35 && <span className="badge ok">笑顔</span>}
          </>
        )}
      </div>
    </div>
  )
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
