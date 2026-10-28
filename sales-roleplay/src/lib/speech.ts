// 音声認識（自分の声 → 文字）と音声合成（AIの文字 → 声）
// どちらもブラウザ標準の機能を使うので無料です（Google Chrome 推奨）

interface RecognitionResultLike {
  isFinal: boolean
  0: { transcript: string }
}

interface RecognitionEventLike {
  resultIndex: number
  results: ArrayLike<RecognitionResultLike>
}

interface RecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: RecognitionEventLike) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
  start(): void
  stop(): void
  abort(): void
}

type RecognitionCtor = new () => RecognitionLike

function getRecognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const isSpeechRecognitionSupported = (): boolean => getRecognitionCtor() !== null

export interface ListenerCallbacks {
  /** 認識途中の文字（画面表示用） */
  onInterim: (text: string) => void
  /** 話し終わった（無音が続いた）ときにまとめて渡される */
  onUtterance: (text: string) => void
  onError: (message: string) => void
}

/**
 * 話し終わりを無音時間で判定して、1回の発言としてまとめるリスナー。
 * マイクを切ったときは stop()、入れ直したときは resume() で聞き取りを再開します。
 */
export class SpeechListener {
  private rec: RecognitionLike | null = null
  private active = false
  /** 確定した文字 */
  private buffer = ''
  /** まだ確定していない（認識途中の）文字 */
  private interim = ''
  /** 送信済みの認識結果の番号。これ以下の結果があとから確定しても二重に送らない */
  private consumedUpTo = -1
  private resultCount = 0
  private silenceTimer: number | undefined
  private lang: string
  private silenceMsFor: (text: string) => number
  private cb: ListenerCallbacks

  /** silenceMsFor: いま聞き取れている文字を見て、何ミリ秒黙ったら送るかを返す */
  constructor(lang: string, silenceMsFor: (text: string) => number, cb: ListenerCallbacks) {
    this.lang = lang
    this.silenceMsFor = silenceMsFor
    this.cb = cb
  }

  start(): void {
    const Ctor = getRecognitionCtor()
    if (!Ctor) {
      this.cb.onError('このブラウザは音声認識に対応していません。Chrome か Edge をお使いください。')
      return
    }
    this.active = true
    const rec = new Ctor()
    rec.lang = this.lang
    rec.continuous = true
    rec.interimResults = true
    this.consumedUpTo = -1
    this.resultCount = 0
    rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (i <= this.consumedUpTo) continue
        const r = e.results[i]
        if (r.isFinal) {
          this.buffer += r[0].transcript
          this.consumedUpTo = i
        } else {
          interim += r[0].transcript
        }
      }
      this.resultCount = e.results.length
      this.interim = interim
      this.cb.onInterim(this.buffer + interim)
      this.resetSilenceTimer()
    }
    rec.onerror = (e) => {
      if (e.error === 'not-allowed') this.cb.onError('マイクの使用が許可されていません。')
    }
    // ブラウザは一定時間で認識が止まるので、聞き取り中なら自動で再開する（結果の番号は0から振り直し）
    rec.onend = () => {
      if (this.active) {
        try {
          this.consumedUpTo = -1
          this.resultCount = 0
          rec.start()
        } catch {
          // すでに開始済みの場合は無視
        }
      }
    }
    this.rec = rec
    rec.start()
  }

  private resetSilenceTimer(): void {
    window.clearTimeout(this.silenceTimer)
    const text = (this.buffer + this.interim).trim()
    if (!text) return
    this.silenceTimer = window.setTimeout(() => this.flush(), this.silenceMsFor(text))
  }

  /** たまっている発言をすぐに送る（認識途中の文字も含める） */
  flush(): void {
    window.clearTimeout(this.silenceTimer)
    const text = (this.buffer + this.interim).trim()
    this.buffer = ''
    this.interim = ''
    // 認識途中だった分があとから確定しても、もう送ったので無視する
    this.consumedUpTo = this.resultCount - 1
    this.cb.onInterim('')
    if (text) this.cb.onUtterance(text)
  }

  pause(): void {
    this.active = false
    window.clearTimeout(this.silenceTimer)
    this.rec?.abort()
    this.rec = null
  }

  resume(): void {
    if (!this.active) this.start()
  }

  stop(): void {
    this.buffer = ''
    this.interim = ''
    this.pause()
  }
}

/**
 * 言い切った形（「〜です」「〜ますか」など）で終わっていれば短く、
 * 「〜で」「〜けど」「えーと」のように続きそうなら長く待ってから送る。
 */
export function silenceMsFor(text: string, pause: { sentenceEnd: number; midSentence: number }): number {
  const t = text.trim().replace(/[\s　]+$/, '')
  return SENTENCE_FINISHED.test(t) ? pause.sentenceEnd : pause.midSentence
}

const SENTENCE_FINISHED =
  /(です|ます|ました|ません|でした|でしょう|ですか|ますか|でしょうか|ですね|ますね|ですよ|ますよ|ください|ございます|お願いします|はい|いいえ|そうです|なるほど|か|ね|よ|[。？！?!])$/

// ---------- 音声合成 ----------

export function getJapaneseVoices(): SpeechSynthesisVoice[] {
  return speechSynthesis.getVoices().filter((v) => v.lang.startsWith('ja'))
}

export function speak(text: string, opts: { voiceName?: string; rate?: number; onStart?: () => void }): Promise<void> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) {
      resolve()
      return
    }
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'ja-JP'
    u.rate = opts.rate ?? 1
    const voice = getJapaneseVoices().find((v) => v.name === opts.voiceName) ?? getJapaneseVoices()[0]
    if (voice) u.voice = voice
    u.onstart = () => opts.onStart?.()
    u.onend = () => resolve()
    u.onerror = () => resolve()
    speechSynthesis.speak(u)
  })
}

export function stopSpeaking(): void {
  if ('speechSynthesis' in window) speechSynthesis.cancel()
}

// ---------- 文ごとの読み上げ（返事が全部そろう前に話し始めるため） ----------

/**
 * 文を受け取った順に読み上げる。stop() で途中でも止められる（ユーザーが話し始めたとき用）。
 */
export class TtsQueue {
  private pending = 0
  /** stop() の前に予約された読み上げの完了通知を無視するための番号 */
  private generation = 0
  private idleWaiters: (() => void)[] = []
  private voiceName: string | undefined
  private rate: number
  private onSpeakingChange: (speaking: boolean) => void

  constructor(opts: { voiceName?: string; rate?: number; onSpeakingChange: (speaking: boolean) => void }) {
    this.voiceName = opts.voiceName
    this.rate = opts.rate ?? 1
    this.onSpeakingChange = opts.onSpeakingChange
  }

  get speaking(): boolean {
    return this.pending > 0
  }

  enqueue(text: string): void {
    if (!text.trim() || !('speechSynthesis' in window)) return
    const gen = this.generation
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'ja-JP'
    u.rate = this.rate
    const voice = getJapaneseVoices().find((v) => v.name === this.voiceName) ?? getJapaneseVoices()[0]
    if (voice) u.voice = voice
    const done = () => {
      if (gen !== this.generation) return
      this.pending = Math.max(0, this.pending - 1)
      if (this.pending === 0) this.becomeIdle()
    }
    u.onend = done
    u.onerror = done
    if (this.pending === 0) this.onSpeakingChange(true)
    this.pending++
    speechSynthesis.speak(u)
  }

  stop(): void {
    this.generation++
    const wasSpeaking = this.pending > 0
    this.pending = 0
    if ('speechSynthesis' in window) speechSynthesis.cancel()
    if (wasSpeaking) this.becomeIdle()
  }

  /** 予約した読み上げがすべて終わるまで待つ */
  whenIdle(): Promise<void> {
    if (this.pending === 0) return Promise.resolve()
    return new Promise((resolve) => this.idleWaiters.push(resolve))
  }

  private becomeIdle(): void {
    this.onSpeakingChange(false)
    const waiters = this.idleWaiters
    this.idleWaiters = []
    waiters.forEach((w) => w())
  }
}

// ---------- 自分の声か、AIの読み上げを拾っただけかの判定 ----------

const normalize = (s: string) => s.replace(/[\s、。，．,.！？!?「」『』（）()ー〜…・]/g, '')

/**
 * マイクがスピーカーから出たAIの声を拾ってしまうことがあるので、
 * 聞き取った文字がAIの直近の発言とほぼ同じなら「AIの声」とみなして無視する。
 */
export function looksLikeEcho(heard: string, recentAiSpeech: string): boolean {
  const h = normalize(heard)
  if (h.length < 2) return true
  const ai = normalize(recentAiSpeech)
  if (!ai) return false
  if (ai.includes(h)) return true
  // 3文字ずつに区切って、半分以上がAIの発言に含まれていればエコーとみなす
  const grams: string[] = []
  for (let i = 0; i + 3 <= h.length; i++) grams.push(h.slice(i, i + 3))
  if (grams.length === 0) return false
  return grams.filter((g) => ai.includes(g)).length / grams.length >= 0.5
}
