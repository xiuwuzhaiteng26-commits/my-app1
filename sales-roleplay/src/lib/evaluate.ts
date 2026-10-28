// 商談の評価：AIの採点＋目線・表情の数値をまとめて総合点を出す
import { RUBRIC } from '../config/rubric'
import { buildEvaluationPrompt } from '../config/prompts'
import { generateJson, type LlmConfig } from './llm'
import { faceScores } from './faceAnalyzer'
import type { ChatMessage, CriterionResult, Evaluation, FaceSummary, Knowledge, Scenario } from './types'

type LlmEvaluation = Omit<Evaluation, 'totalScore'>

export async function evaluateSession(
  scenario: Scenario,
  messages: ChatMessage[],
  face: FaceSummary | null,
  k: Knowledge,
  llm: LlmConfig,
): Promise<Evaluation> {
  const raw = await generateJson<LlmEvaluation>(buildEvaluationPrompt(scenario, messages, face, k), {
    ...llm,
    temperature: 0.2,
    effort: 'high',
  })

  // AIが返さなかった項目は0点にせず、総合点の計算から外す
  const criteria: CriterionResult[] = RUBRIC.filter((c) => c.source === 'llm').flatMap((c) => {
    const found = raw.criteria?.find((r) => r.id === c.id)
    if (!found) return []
    return [
      {
        id: c.id,
        score: clamp(found.score),
        comment: found.comment ?? '',
        goodPoints: found.goodPoints ?? [],
        improvements: found.improvements ?? [],
      },
    ]
  })

  if (face && face.faceDetectedRate > 0) {
    const fs = faceScores(face)
    criteria.push(
      {
        id: 'eyeContact',
        score: fs.eyeContact,
        comment: `話している間のカメラ目線率 ${pct(face.eyeContactWhileSpeaking)}、聞いている間 ${pct(face.eyeContactWhileListening)}`,
        goodPoints: [],
        improvements:
          fs.eyeContact < 70 ? ['大事なことを話すときはカメラのレンズを見る。カメラの近くに相手の映像を置くと自然に見られます'] : [],
      },
      {
        id: 'expression',
        score: fs.expression,
        comment: `笑顔の割合 ${pct(face.smileRate)}、表情の変化 ${pct(face.expressiveness)}`,
        goodPoints: [],
        improvements: fs.expression < 70 ? ['挨拶・お礼・相手の話に共感するときは、口角を上げることを意識しましょう'] : [],
      },
    )
  }

  return {
    totalScore: totalScore(criteria),
    summary: raw.summary ?? '',
    criteria,
    questionReviews: (raw.questionReviews ?? []).map((q) => ({ ...q, score: clamp(q.score) })),
    hiddenIssueDiscovery: raw.hiddenIssueDiscovery ?? [],
    nextPracticeTips: raw.nextPracticeTips ?? [],
  }
}

/** 重み付き平均。カメラを使わなかった場合は目線・表情を除いて計算する */
export function totalScore(results: CriterionResult[]): number {
  let sum = 0
  let weights = 0
  for (const r of results) {
    const c = RUBRIC.find((x) => x.id === r.id)
    if (!c) continue
    sum += r.score * c.weight
    weights += c.weight
  }
  return weights ? Math.round(sum / weights) : 0
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(Number(n) || 0)))
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`
}
