import { useCallback, useEffect, useRef, useState } from 'react'
import Avatar from './Avatar'
import CameraView from './CameraView'
import { AbortedError, generateStream, type LlmTurn } from '../lib/llm'
import { SpeechListener, TtsQueue, isSpeechRecognitionSupported, looksLikeEcho } from '../lib/speech'
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

/** ここまで来たら1文として読み上げを始める区切り */
const SENTENCE_END = /[。！？!?\n]/

/** AIの返事から、画面と読み上げに出さない部分を取り除く */
const cleanReply = (text: string) => text.replaceAll(END_MARKER, '').replace(/（経過時間[^）]*）/g, '')

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
  const ttsRef = useRef<TtsQueue | null>(null)
  const aiSpeakingRef = useRef(false)
  const interimRef = useRef('')
  const micOnRef = useRef(true)
  const finishedRef = useRef(false)
  /** 返事を作っている最中のリクエスト（こちらが話し始めたら打ち切る） */
  const requestRef = useRef<AbortController | null>(null)
  /** 返事の最初の文字が届いたか */
  const replyStartedRef = useRef(false)
  /** 返事が届く前に話を続けたときに、前の発言とつなげるための保留分 */
  const carryRef = useRef('')
  /** 直近にAIが読み上げた文（マイクが拾ったAIの声を無視するため） */
  const recentAiSpeechRef = useRef('')
  const [systemPrompt] = useState(() => buildRoleplaySystemPrompt(scenario, setup, settings))

  const elapsedSec = () => (startRef.current ? Math.floor((Date.now() - startRef.current) / 1000) : 0)

  const commitMessages = (next: ChatMessage[]) => {
    messagesRef.current = next
    setMessages(next)
  }
  const addMessage = (m: Omit<ChatMessage, 'at'>) => commitMessages([...messagesRef.current, { ...m, at: elapsedSec() }])
  const replaceLastMessage = (text: string) => {
    const list = messagesRef.current
    commitMessages([...list.slice(0, -1), { ...list[list.length - 1], text }])
  }

  const speakAi = (text: string) => {
    const t = text.trim()
    if (!t) return
    recentAiSpeechRef.current = (recentAiSpeechRef.current + t).slice(-400)
    ttsRef.current?.enqueue(t)
  }

  const finish = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    requestRef.current?.abort()
    listenerRef.current?.stop()
    ttsRef.current?.stop()
    onFinish({ messages: messagesRef.current, face: summarize(samplesRef.current), durationSec: elapsedSec() })
  }, [onFinish])

  /**
   * こちらが話し始めたときの処理。
   * - AIが話していれば、その場で止める
   * - 返事を作っている途中なら打ち切る。まだ1文字も届いていなければ、さっきの発言は「話の途中」とみなして次の発言とつなげる
   */
  const interruptAi = () => {
    if (APP_DEFAULTS.bargeIn && ttsRef.current?.speaking) ttsRef.current.stop()
    const req = requestRef.current
    if (!req) return
    req.abort()
    requestRef.current = null
    setThinking(false)
    if (!replyStartedRef.current) {
      const last = messagesRef.current[messagesRef.current.length - 1]
      if (last?.role === 'user') {
        carryRef.current = last.text
        commitMessages(messagesRef.current.slice(0, -1))
      }
    }
  }

  const sendToAi = async (said: string) => {
    if (finishedRef.current) return
    // 先に前の返事を止める（届く前なら、前の発言が carryRef に戻る）
    interruptAi()
    const text = [carryRef.current, said.trim()].filter(Boolean).join(' ')
    carryRef.current = ''
    if (!text) return
    addMessage({ role: 'user', text })
    setError('')
    setThinking(true)

    const controller = new AbortController()
    requestRef.current = controller
    replyStartedRef.current = false

    const turns: LlmTurn[] = [{ role: 'user', text: JOIN_NOTE }]
    const history = messagesRef.current
    history.forEach((m, i) => {
      const isLast = i === history.length - 1
      const body = isLast ? withTimeNote(m.text, Math.floor(elapsedSec() / 60), setup.maxMinutes) : m.text
      turns.push({ role: m.role === 'user' ? 'user' : 'model', text: body })
    })

    let full = ''
    let spokenUpTo = 0
    try {
      full = await generateStream(turns, {
        ...llmConfig(settings),
        system: systemPrompt,
        signal: controller.signal,
        onText: (delta) => {
          if (controller.signal.aborted) return
          if (!replyStartedRef.current) {
            replyStartedRef.current = true
            setThinking(false)
            addMessage({ role: 'ai', text: '' })
          }
          full += delta
          replaceLastMessage(cleanReply(full).trim())
          // 文の区切りまで届いた分から、順に読み上げる
          const rest = full.slice(spokenUpTo)
          let cut = -1
          for (let i = rest.length - 1; i >= 0; i--) {
            if (SENTENCE_END.test(rest[i])) {
              cut = i
              break
            }
          }
          if (cut >= 0) {
            speakAi(cleanReply(rest.slice(0, cut + 1)))
            spokenUpTo += cut + 1
          }
        },
      })
    } catch (e) {
      if (e instanceof AbortedError) return
      setThinking(false)
      setError((e as Error).message)
      requestRef.current = null
      return
    }
    if (controller.signal.aborted) return
    requestRef.current = null
    setThinking(false)
    speakAi(cleanReply(full.slice(spokenUpTo)))
    if (full.includes(END_MARKER)) {
      await ttsRef.current?.whenIdle()
      finish()
    }
  }
  // 音声認識のコールバックから常に最新の関数を呼ぶため
  const sendRef = useRef(sendToAi)
  const interruptRef = useRef(interruptAi)
  useEffect(() => {
    sendRef.current = sendToAi
    interruptRef.current = interruptAi
  })

  const begin = () => {
    setStarted(true)
    startRef.current = Date.now()
    ttsRef.current = new TtsQueue({
      voiceName: settings.ttsVoice,
      rate: APP_DEFAULTS.ttsRate,
      onSpeakingChange: (speaking) => {
        aiSpeakingRef.current = speaking
        setAiSpeaking(speaking)
      },
    })
    listenerRef.current = new SpeechListener(APP_DEFAULTS.speechLang, APP_DEFAULTS.autoSendSilenceMs, {
      onInterim: (t) => {
        // スピーカーから出たAIの声を拾っただけなら、自分の発言として扱わない
        const mine = t && !looksLikeEcho(t, recentAiSpeechRef.current)
        interimRef.current = mine ? t : ''
        setInterim(mine ? t : '')
        if (mine) interruptRef.current()
      },
      onUtterance: (t) => {
        if (looksLikeEcho(t, recentAiSpeechRef.current)) return
        void sendRef.current(t)
      },
      onError: setError,
    })
    addMessage({ role: 'ai', text: scenario.openingLine })
    speakAi(scenario.openingLine)
    // AIが話している間も聞き取りを続け、話し始めたらAIを止められるようにする
    if (micOnRef.current) listenerRef.current.start()
  }

  // 経過時間の表示と、予定時間での自動終了
  useEffect(() => {
    if (!started) return
    const id = window.setInterval(() => {
      const s = elapsedSec()
      setElapsed(s)
      if (s >= setup.maxMinutes * 60 && !requestRef.current) finish()
    }, 1000)
    return () => window.clearInterval(id)
  }, [started, setup.maxMinutes, finish])

  // 新しい発言が来たら一番下までスクロール
  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight })
  }, [messages, interim])

  // 画面を離れたら音声とリクエストを止める
  useEffect(
    () => () => {
      requestRef.current?.abort()
      listenerRef.current?.stop()
      ttsRef.current?.stop()
    },
    [],
  )

  const toggleMic = () => {
    const next = !micOn
    setMicOn(next)
    micOnRef.current = next
    if (next) listenerRef.current?.resume()
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
          <p className="hint">イヤホンを使うと、AIの声をマイクが拾いにくくなり、話し始めたときにAIを止める動きが安定します。</p>
          {!isSpeechRecognitionSupported() && (
            <p className="error">このブラウザは音声認識に対応していません。Chrome か Edge を使うか、文字入力で進めてください。</p>
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
                void sendToAi(typed)
                setTyped('')
              }}
            >
              <input placeholder="文字で入力することもできます" value={typed} onChange={(e) => setTyped(e.target.value)} />
              <button type="submit" disabled={!typed.trim()}>
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
