import type { QuizAnswers, TouringSpot } from '../types'

const DIFFICULTY_ORDER = ['初級', '中級', '上級'] as const

export function scoreSpot(spot: TouringSpot, answers: QuizAnswers): number {
  let score = 0

  if (answers.difficulty) {
    if (spot.difficulty === answers.difficulty) {
      score += 3
    } else {
      const diff = Math.abs(
        DIFFICULTY_ORDER.indexOf(spot.difficulty) -
          DIFFICULTY_ORDER.indexOf(answers.difficulty),
      )
      if (diff === 1) score += 1
    }
  }

  if (answers.scenery && spot.scenery.includes(answers.scenery)) {
    score += 3
  }

  if (answers.season && spot.bestSeasons.includes(answers.season)) {
    score += 3
  }

  if (answers.duration && spot.duration === answers.duration) {
    score += 2
  }

  return score
}

export function hasAnyAnswer(answers: QuizAnswers): boolean {
  return Object.values(answers).some((v) => v !== null)
}

export function getRecommendations(
  spots: TouringSpot[],
  answers: QuizAnswers,
  topN = 3,
): TouringSpot[] {
  if (!hasAnyAnswer(answers)) return []

  return [...spots]
    .map((spot) => ({ spot, score: scoreSpot(spot, answers) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .filter((entry) => entry.score > 0)
    .map((entry) => entry.spot)
}
