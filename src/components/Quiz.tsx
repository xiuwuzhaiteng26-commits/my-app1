import type { Difficulty, Duration, QuizAnswers, Scenery, Season } from '../types'

interface Props {
  answers: QuizAnswers
  onChange: (answers: QuizAnswers) => void
  onReset: () => void
}

const DIFFICULTIES: Difficulty[] = ['初級', '中級', '上級']
const SCENERIES: Scenery[] = ['海岸', '山岳', '湖', '高原', '渓谷', '離島']
const SEASONS: Season[] = ['春', '夏', '秋', '冬']
const DURATIONS: Duration[] = ['日帰り', '1泊2日', '2泊3日以上']

function Quiz({ answers, onChange, onReset }: Props) {
  const setAnswer = <K extends keyof QuizAnswers>(key: K, value: QuizAnswers[K]) => {
    onChange({ ...answers, [key]: answers[key] === value ? null : value })
  }

  return (
    <div className="quiz">
      <div className="quiz__row">
        <span className="quiz__label">走行レベル</span>
        <div className="quiz__options">
          {DIFFICULTIES.map((d) => (
            <button
              key={d}
              type="button"
              className={`chip${answers.difficulty === d ? ' chip--active' : ''}`}
              onClick={() => setAnswer('difficulty', d)}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="quiz__row">
        <span className="quiz__label">見たい景色</span>
        <div className="quiz__options">
          {SCENERIES.map((s) => (
            <button
              key={s}
              type="button"
              className={`chip${answers.scenery === s ? ' chip--active' : ''}`}
              onClick={() => setAnswer('scenery', s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="quiz__row">
        <span className="quiz__label">行きたい季節</span>
        <div className="quiz__options">
          {SEASONS.map((s) => (
            <button
              key={s}
              type="button"
              className={`chip${answers.season === s ? ' chip--active' : ''}`}
              onClick={() => setAnswer('season', s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="quiz__row">
        <span className="quiz__label">日程</span>
        <div className="quiz__options">
          {DURATIONS.map((d) => (
            <button
              key={d}
              type="button"
              className={`chip${answers.duration === d ? ' chip--active' : ''}`}
              onClick={() => setAnswer('duration', d)}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <button type="button" className="quiz__reset" onClick={onReset}>
        条件をリセット
      </button>
    </div>
  )
}

export default Quiz
