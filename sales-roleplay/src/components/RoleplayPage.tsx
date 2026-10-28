import { useCallback, useEffect, useRef, useState } from 'react'
import Avatar from './Avatar'
import CameraView from './CameraView'
import { generate, type LlmTurn } from '../lib/llm'
import { SpeechListener, isSpeechRecognitionSupported, speak, stopSpeaking } from '../lib/speech'
import { summarize } from '../lib/faceAnalyzer'
import { buildRoleplaySystemPrompt, END_MARKER, withTimeNote } from '../config/prompts'
import { APP_DEFAULTS } from '../config/settings'
import { llmConfig, type AppSettings } from '../lib/storage'
import type { ChatMessage, FaceSample, FaceSummary, Scenario, SessionSetup } from '../lib/types'

export interface RoleplayResult {
  messages: ChatMessage[]
  face: FaceSummary | null
  durationSec: number
}

interface Props {
  settings: AppSettings
  setup: SessionSetup
  scenario: Scenario
  onFinish: (r: RoleplayResult) => void
}

/** Gemini は会話がユーザーの発言から始まる必要があるため、最初に入れておく合図 */
const JOIN_NOTE = '（オンライン会議に営業担当者が接続しました。挨拶から始めてください）'

export default function RoleplayPage({ settings, setup, scenario, onFinish }: Props) {
  const [started, setStarted] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [interim, setInterim] = useState('')
  const [aiSpeaking, setAiSpeaking] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [micOn, setMicOn] = useState(true)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [typed, setTyped] = useState('')

  const transcriptRef = useRef<HTMLDivElement>(null)
  const startRef = useRef(0)
  const messagesRef = useRef<ChatMessage[]>([])
  const samplesRef = useRef<FaceSample[]>([])
  const listenerRef = useRef<SpeechListener | null>(null)
  const aiSpeakingRef = useRef(false)
  const interimRef = useRef('')
  const micOnRef = useRef(true)
  const busyRef = useRef(false)
  const finishedRef = useRef(false)
  const [systemPrompt] = useState(() => buildRoleplaySystemPrompt(scenario, setup, settings))

  const elapsedSec = () => (startRef.current ? Math.floor((Date.now() - startRef.current) / 1000) : 0)

  const addMessage = (m: Omit<ChatMessage, 'at'>) => {
    const msg = { ...m, at: elapsedSec() }
    messagesRef.current = [...messagesRef.current, msg]
    setMessages(messagesRef.current)
  }

  const finish = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    listenerRef.current?.stop()
    stopSpeaking()
    onFinish({ messages: messagesRef.current, face: summarize(samplesRef.current), durationSec: elapsedSec() })
  }, [onFinish])

  const aiSay = async (text: string) => {
    listenerRef.current?.pause()
    await speak(text, {
      voiceName: settings.ttsVoice,
      rate: APP_DEFAULTS.ttsRate,
      onStart: () => {
        aiSpeakingRef.current = true
        setAiSpeaking(true)
      },
    })
    aiSpeakingRef.current = false
    setAiSpeaking(false)
  }

  const resumeListening = () => {
    if (micOnRef.current && !finishedRef.current) listenerRef.current?.resume()
  }

  const handleUserText = async (text: string) => {
    if (busyRef.current || finishedRef.current || !text.trim()) return
    busyRef.current = true
    listenerRef.current?.pause()
    addMessage({ role: 'user', text })
    setThinking(true)
    setError('')
    try {
      const turns: LlmTurn[] = [{ role: 'user', text: JOIN_NOTE }]
      const history = messagesRef.current
      history.forEach((m, i) => {
        const isLast = i === history.length - 1
        const body = isLast ? withTimeNote(m.text, Math.floor(elapsedSec() / 60), setup.maxMinutes) : m.text
        turns.push({ role: m.role === 'user' ? 'user' : 'model', text: body })
      })
      // 会話は待ち時間を短くしたいので、考える深さは low にする
      const reply = await generate(turns, { ...llmConfig(settings), system: systemPrompt, effort: 'low' })
      const ended = reply.includes(END_MARKER)
      const clean = reply.replaceAll(END_MARKER, '').replace(/（経過時間[^）]*）/g, '').trim()
      setThinking(false)
      addMessage({ role: 'ai', text: clean })
      await aiSay(clean)
      if (ended) {
        finish()
        return
      }
    } catch (e) {
      setThinking(false)
      setError((e as Error).message)
    } finally {
      busyRef.current = false
    }
    resumeListening()
  }
  // 音声認識のコールバックから常に最新の関数を呼ぶため
  const handleRef = useRef(handleUserText)
  useEffect(() => {
    handleRef.current = handleUserText
  })

  const begin = async () => {
    setStarted(true)
    startRef.current = Date.now()
    listenerRef.current = new SpeechListener(APP_DEFAULTS.speechLang, APP_DEFAULTS.autoSendSilenceMs, {
      onInterim: (t) => {
        interimRef.current = t
        setInterim(t)
      },
      onUtterance: (t) => void handleRef.current(t),
      onError: setError,
    })
    addMessage({ role: 'ai', text: scenario.openingLine })
    await aiSay(scenario.openingLine)
    resumeListening()
  }

  // 経過時間の表示と、予定時間での自動終了
  useEffect(() => {
    if (!started) return
    const id = window.setInterval(() => {
      const s = elapsedSec()
      setElapsed(s)
      if (s >= setup.maxMinutes * 60 && !busyRef.current) finish()
    }, 1000)
    return () => window.clearInterval(id)
  }, [started, setup.maxMinutes, finish])

  // 新しい発言が来たら一番下までスクロール
  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight })
  }, [messages, interim])

  // 画面を離れたら音声を止める
  useEffect(
    () => () => {
      listenerRef.current?.stop()
      stopSpeaking()
    },
    [],
  )

  const toggleMic = () => {
    const next = !micOn
    setMicOn(next)
    micOnRef.current = next
    if (next) resumeListening()
    else listenerRef.current?.stop()
  }

  const remaining = setup.maxMinutes * 60 - elapsed
  const nearEnd = started && remaining <= APP_DEFAULTS.wrapUpWarningMinutes * 60

  return (
    <div className="page roleplay">
      <div className="meeting-header">
        <span>
          {scenario.universityName} キャリアセンター／{scenario.contactRole} {scenario.contactName}
        </span>
        <span className={nearEnd ? 'timer warn' : 'timer'}>
          {fmt(elapsed)} / {setup.maxMinutes}:00
        </span>
      </div>

      <div className="tiles">
        <Avatar speaking={aiSpeaking} thinking={thinking} name={`${scenario.contactName}（${scenario.contactRole}）`} />
        <CameraView
          recording={started}
          getElapsed={elapsedSec}
          getPhase={() => (aiSpeakingRef.current ? 'ai' : interimRef.current ? 'user' : 'idle')}
          onSample={(s) => samplesRef.current.push(s)}
        />
      </div>

      {!started ? (
        <div className="card center">
          <p>準備ができたら「商談に入る」を押してください。相手から挨拶が始まります。</p>
          {!isSpeechRecognitionSupported() && (
            <p className="error">このブラウザは音声認識に対応していません。Chromeを使うか、文字入力で進めてください。</p>
          )}
          <button className="primary" onClick={begin}>
            商談に入る
          </button>
        </div>
      ) : (
        <>
          <div className="transcript" ref={transcriptRef}>
            {messages.map((m, i) => (
              <div key={i} className={`bubble ${m.role}`}>
                <span className="who">{m.role === 'user' ? 'あなた' : scenario.contactName}</span>
                {m.text}
              </div>
            ))}
            {interim && <div className="bubble user interim">{interim}</div>}
          </div>

          {error && <p className="error">{error}</p>}

          <div className="controls">
            <button onClick={toggleMic} className={micOn ? 'mic on' : 'mic'}>
              {micOn ? '🎤 マイクON' : 'マイクOFF'}
            </button>
            <button onClick={() => listenerRef.current?.flush()} disabled={!interim}>
              話し終わった（すぐ送る）
            </button>
            <form
              className="typed"
              onSubmit={(e) => {
                e.preventDefault()
                void handleUserText(typed)
                setTyped('')
              }}
            >
              <input placeholder="文字で入力することもできます" value={typed} onChange={(e) => setTyped(e.target.value)} />
              <button type="submit" disabled={!typed.trim() || thinking}>
                送信
              </button>
            </form>
            <button className="danger" onClick={finish}>
              商談を終了して評価
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function fmt(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}
