import { useState } from 'react'
import SettingsPage from './components/SettingsPage'
import SetupPage from './components/SetupPage'
import RoleplayPage, { type RoleplayResult } from './components/RoleplayPage'
import ResultPage from './components/ResultPage'
import HistoryPage from './components/HistoryPage'
import { deleteRecord, llmConfig, loadHistory, loadSettings, saveRecord, saveSettings, type AppSettings } from './lib/storage'
import type { Scenario, SessionRecord, SessionSetup } from './lib/types'

type View =
  | { name: 'setup' }
  | { name: 'settings' }
  | { name: 'history' }
  | { name: 'roleplay'; setup: SessionSetup; scenario: Scenario; startedAt: string }
  | { name: 'result'; record: SessionRecord }

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [history, setHistory] = useState<SessionRecord[]>(loadHistory)
  const [view, setView] = useState<View>(() => (llmConfig(loadSettings()).apiKey ? { name: 'setup' } : { name: 'settings' }))

  const updateRecord = (r: SessionRecord) => {
    saveRecord(r)
    setHistory(loadHistory())
    setView({ name: 'result', record: r })
  }

  const finishRoleplay = (v: Extract<View, { name: 'roleplay' }>) => (res: RoleplayResult) =>
    updateRecord({
      id: crypto.randomUUID(),
      startedAt: v.startedAt,
      durationSec: res.durationSec,
      setup: v.setup,
      scenario: v.scenario,
      messages: res.messages,
      face: res.face,
      evaluation: null,
    })

  const inMeeting = view.name === 'roleplay'

  return (
    <div className="app">
      <header className="app-header">
        <h1>商談AIロープレ</h1>
        {!inMeeting && (
          <nav>
            <button className={view.name === 'setup' ? 'active' : ''} onClick={() => setView({ name: 'setup' })}>
              練習する
            </button>
            <button className={view.name === 'history' ? 'active' : ''} onClick={() => setView({ name: 'history' })}>
              履歴
            </button>
            <button className={view.name === 'settings' ? 'active' : ''} onClick={() => setView({ name: 'settings' })}>
              設定
            </button>
          </nav>
        )}
      </header>

      <main>
        {view.name === 'settings' && (
          <SettingsPage
            settings={settings}
            onSave={(s) => {
              saveSettings(s)
              setSettings(s)
            }}
          />
        )}
        {view.name === 'setup' && (
          <SetupPage
            settings={settings}
            onStart={(setup, scenario) =>
              setView({ name: 'roleplay', setup, scenario, startedAt: new Date().toISOString() })
            }
          />
        )}
        {view.name === 'roleplay' && (
          <RoleplayPage settings={settings} setup={view.setup} scenario={view.scenario} onFinish={finishRoleplay(view)} />
        )}
        {view.name === 'result' && (
          <ResultPage
            key={view.record.id}
            record={view.record}
            settings={settings}
            onUpdate={updateRecord}
            onRetry={() => setView({ name: 'setup' })}
          />
        )}
        {view.name === 'history' && (
          <HistoryPage
            history={history}
            onOpen={(record) => setView({ name: 'result', record })}
            onDelete={(id) => {
              deleteRecord(id)
              setHistory(loadHistory())
            }}
          />
        )}
      </main>
    </div>
  )
}
