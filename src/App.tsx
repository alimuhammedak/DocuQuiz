import { useState } from 'react'
import Home from './screens/Home'
import Setup from './screens/Setup'
import Quiz from './screens/Quiz'
import Results from './screens/Results'
import Review from './screens/Review'

export interface Scope {
  /** ders adı; tanımsız = tüm dersler ("Tümü") */
  subjectFilter?: string
  label: string
}

export type Route =
  | { name: 'home' }
  | { name: 'setup'; examId: string; scope: Scope }
  | { name: 'quiz'; sessionId: string }
  | { name: 'results'; sessionId: string }
  | { name: 'review'; sessionId: string; index: number }

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'home' })

  return (
    <div className="app">
      <header className="topbar">
        <button className="wordmark" onClick={() => setRoute({ name: 'home' })}>
          Docu<span className="wordmark-accent">Quiz</span>
        </button>
        <span className="privacy-pill" title="Hiçbir veri sunucuya gönderilmez">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" />
          </svg>
          Verilerin tarayıcında kalır
        </span>
      </header>
      <div className="shell">
        {route.name === 'home' && <Home navigate={setRoute} />}
        {route.name === 'setup' && <Setup examId={route.examId} scope={route.scope} navigate={setRoute} />}
        {route.name === 'quiz' && <Quiz key={route.sessionId} sessionId={route.sessionId} navigate={setRoute} />}
        {route.name === 'results' && <Results sessionId={route.sessionId} navigate={setRoute} />}
        {route.name === 'review' && (
          <Review sessionId={route.sessionId} initialIndex={route.index} navigate={setRoute} />
        )}
      </div>
    </div>
  )
}
