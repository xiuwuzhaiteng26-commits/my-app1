// ============================================================
// 商材・業界の知識
// ------------------------------------------------------------
// ★ このリポジトリは公開されるため、社内情報（サービスの詳細、実績、契約先、
//   営業の進め方など）はここに書かず、アプリの「設定」画面に入力してください。
//   設定はブラウザの中にだけ保存され、ファイルに書き出して社内で共有できます。
// ★ ここには、どの会社にも当てはまる一般的な内容だけを置きます。
// ============================================================
import type { Knowledge } from '../lib/types'

/** 設定画面の初期値（すべて空。入力例は KNOWLEDGE_FIELDS の placeholder に表示） */
export const EMPTY_KNOWLEDGE: Knowledge = {
  serviceInfo: '',
  universityInfo: '',
  contactRole: '',
  currentSituation: '',
  serviceFacts: '',
  differentiators: '',
  realWorries: '',
  mustAskQuestions: '',
  closingGoal: '',
  sampleBackgrounds: '',
}

/** 設定画面に並べる入力欄（順番・説明文・入力例） */
export const KNOWLEDGE_FIELDS: { key: keyof Knowledge; label: string; hint: string; placeholder: string; rows: number }[] = [
  {
    key: 'serviceInfo',
    label: 'サービス情報',
    hint: 'サービスの概要・機能・料金など。AIはこの内容をもとに質問します。',
    placeholder: '例）\n- サービス概要：\n- 主な機能：\n- 料金体系：\n- よくある質問と回答：\n- できないこと：',
    rows: 8,
  },
  {
    key: 'serviceFacts',
    label: 'サービスの事実（1行に1つ）',
    hint: '実績・料金の負担者・言い切ってはいけないことなど。営業の発言が事実と合っているかの評価に使います。',
    placeholder: '例）\n料金は〇〇が支払う\n導入実績は〇校\n〇〇とは言い切れない',
    rows: 5,
  },
  {
    key: 'differentiators',
    label: '他の選択肢との違い（1行に1つ）',
    hint: '相手がすでに使っているサービスとの違い。違いを相手の悩みに結びつけて伝えられたかの評価に使います。',
    placeholder: '例）\n〇〇は△△をするが、自社は□□をする',
    rows: 5,
  },
  {
    key: 'contactRole',
    label: '商談相手の立場',
    hint: '空欄ならアポ背景から自動で決めます。',
    placeholder: '例）キャリアセンターの責任者（導入を判断できる立場）',
    rows: 1,
  },
  {
    key: 'currentSituation',
    label: '大学の今の取り組み・予算の考え方',
    hint: '相手の大学が今どんなサービスを使っているか、お金を出す・出さないの判断基準など。',
    placeholder: '例）\n- 学内セミナーを外部の会社に依頼している\n- 〇〇には予算を出さない',
    rows: 5,
  },
  {
    key: 'realWorries',
    label: '実際の商談で出てきた悩み（1行に1つ）',
    hint: '「電話では言っていない悩み」を作るときに優先して使います。',
    placeholder: '例）\n学生がキャリアセンターに来ない',
    rows: 4,
  },
  {
    key: 'mustAskQuestions',
    label: 'AIが必ず聞く質問（1行に1つ）',
    hint: '「質問 → 答えを受けて続けて聞くこと」の形で書けます（→ 以降は省略可）。',
    placeholder: '例）\n実績はどのくらいありますか？ → 少ないと分かったら不安を口にする',
    rows: 4,
  },
  {
    key: 'closingGoal',
    label: '商談のゴール',
    hint: '締めくくりで目指す合意。クロージングの評価に使います。',
    placeholder: '例）いきなり本導入ではなく、まずお試しでの利用に合意してもらう',
    rows: 2,
  },
  {
    key: 'universityInfo',
    label: '大学・キャリアセンターに関する一般的な情報',
    hint: '実在の大学名・担当者名は入れないでください。',
    placeholder: '例）\n- 予算の時期（秋〜冬に次年度予算を申請）\n- 決裁の流れ（担当→課長→部長）',
    rows: 5,
  },
  {
    key: 'sampleBackgrounds',
    label: 'アポ背景のサンプル',
    hint: '商談準備画面のサンプルボタンになります。サンプルどうしは「---」だけの行で区切り、各サンプルの1行目がボタン名です。',
    placeholder: '例）\nサンプル1の名前\n・アポ背景の内容\n---\nサンプル2の名前\n・…',
    rows: 8,
  },
]

/** 1行に1つ書かれた欄を配列にする */
export function lines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/^[-・\s]+/, '').trim())
    .filter(Boolean)
}

/** 「質問 → 続けて聞くこと」の形を分解する */
export function parseMustAsk(text: string): { question: string; followUp: string }[] {
  return lines(text).map((l) => {
    const [question, ...rest] = l.split(/\s*(?:→|->)\s*/)
    return { question, followUp: rest.join(' → ') }
  })
}

/** アポ背景のサンプルを「---」で区切って、1行目をボタン名にする */
export function parseSamples(text: string): { label: string; text: string }[] {
  return text
    .split(/^\s*---\s*$/m)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const [label, ...body] = block.split('\n')
      return { label: label.trim(), text: body.join('\n').trim() || label.trim() }
    })
}

/** 取引先の名前の扱い（実際の商談でも、大学は取引先の社名をなかなか言わない） */
export const SPEAKING_RULE = '取引のある会社の名前は出さず、「外部の会社さん」のようにぼかして言う'

/**
 * サービスの話以外で、職員役のAIが投げかける話題（一般的な内容）
 * シナリオを作るときに、ここからいくつかを組み込みます。
 */
export const OFF_TOPIC_THEMES = [
  '最近の就職活動のトレンド（早期化、インターンシップの扱いの変化など）',
  '他大学のキャリアセンターがどんな取り組みをしているか',
  '学生のキャリア意識や、低学年のうちから何をさせるべきか',
  '営業担当者自身の経歴や、なぜこの仕事をしているのか',
  '企業の採用担当者が学生のどこを見ているか',
  'キャリアセンター職員の業務負担や働き方',
  '学生の保護者からの問い合わせへの対応',
]
