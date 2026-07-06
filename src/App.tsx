import { useState } from 'react'
import Home from './screens/Home'
import Setup from './screens/Setup'
import Quiz from './screens/Quiz'
import Results from './screens/Results'
import Review from './screens/Review'

export type Route =
  | { name: 'home' }
  | { name: 'setup'; examId: string; section?: string }
  | { name: 'quiz'; sessionId: string }
  | { name: 'results'; sessionId: string }
  | { name: 'review'; sessionId: string; index: number }

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'home' })

  return (
    <div className="app">
      {route.name === 'home' && <Home navigate={setRoute} />}
      {route.name === 'setup' && (
        <Setup examId={route.examId} initialSection={route.section} navigate={setRoute} />
      )}
      {route.name === 'quiz' && <Quiz key={route.sessionId} sessionId={route.sessionId} navigate={setRoute} />}
      {route.name === 'results' && <Results sessionId={route.sessionId} navigate={setRoute} />}
      {route.name === 'review' && (
        <Review sessionId={route.sessionId} initialIndex={route.index} navigate={setRoute} />
      )}
    </div>
  )
}
