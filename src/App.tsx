import { useMemo, useState } from 'react'
import './App.css'
import Quiz from './components/Quiz'
import FilterBar from './components/FilterBar'
import SpotCard from './components/SpotCard'
import SpotModal from './components/SpotModal'
import { spots } from './data/spots'
import type { QuizAnswers, Region, TouringSpot } from './types'
import { getRecommendations, hasAnyAnswer } from './utils/recommend'

const EMPTY_ANSWERS: QuizAnswers = {
  difficulty: null,
  scenery: null,
  season: null,
  duration: null,
}

function App() {
  const [answers, setAnswers] = useState<QuizAnswers>(EMPTY_ANSWERS)
  const [search, setSearch] = useState('')
  const [region, setRegion] = useState<Region | 'すべて'>('すべて')
  const [selectedSpot, setSelectedSpot] = useState<TouringSpot | null>(null)

  const recommendations = useMemo(() => getRecommendations(spots, answers, 3), [answers])
  const recommendedIds = useMemo(() => new Set(recommendations.map((s) => s.id)), [recommendations])

  const filteredSpots = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return spots.filter((spot) => {
      const matchesRegion = region === 'すべて' || spot.region === region
      const matchesSearch =
        keyword === '' ||
        spot.name.toLowerCase().includes(keyword) ||
        spot.prefecture.toLowerCase().includes(keyword)
      return matchesRegion && matchesSearch
    })
  }, [search, region])

  return (
    <div className="app">
      <header className="header">
        <h1 className="header__title">🚴 バイクツーリング スポットナビ</h1>
        <p className="header__subtitle">
          全国{spots.length}箇所から、あなたにぴったりのツーリングスポットを見つけよう
        </p>
      </header>

      <main>
        <section className="section">
          <h2 className="section__heading">1. 簡単診断でおすすめを見つける</h2>
          <p className="section__lead">気になる条件をタップしてください（複数選択OK・未選択でもOK）</p>
          <Quiz answers={answers} onChange={setAnswers} onReset={() => setAnswers(EMPTY_ANSWERS)} />

          <div className="recommend-result">
            {hasAnyAnswer(answers) ? (
              recommendations.length > 0 ? (
                <div className="grid grid--recommend">
                  {recommendations.map((spot, i) => (
                    <div key={spot.id} className="recommend-item">
                      <span className="recommend-rank">おすすめ #{i + 1}</span>
                      <SpotCard spot={spot} onSelect={setSelectedSpot} highlight />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="recommend-empty">条件に近いスポットが見つかりませんでした。条件を減らしてみてください。</p>
              )
            ) : (
              <p className="recommend-empty">条件を選ぶと、あなたへのおすすめがここに表示されます。</p>
            )}
          </div>
        </section>

        <section className="section">
          <h2 className="section__heading">2. スポットを探す</h2>
          <FilterBar
            search={search}
            onSearchChange={setSearch}
            region={region}
            onRegionChange={setRegion}
            resultCount={filteredSpots.length}
          />
          <div className="grid">
            {filteredSpots.map((spot) => (
              <SpotCard
                key={spot.id}
                spot={spot}
                onSelect={setSelectedSpot}
                highlight={recommendedIds.has(spot.id)}
              />
            ))}
            {filteredSpots.length === 0 && (
              <p className="recommend-empty">該当するスポットがありません。検索条件を変更してください。</p>
            )}
          </div>
        </section>
      </main>

      <footer className="footer">
        <p>掲載情報は目安です。走行前に道路状況・通行止め情報を必ず公式サイトでご確認ください。</p>
      </footer>

      {selectedSpot && <SpotModal spot={selectedSpot} onClose={() => setSelectedSpot(null)} />}
    </div>
  )
}

export default App
