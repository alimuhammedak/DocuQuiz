import { useEffect, useState } from 'react'
import type { Route } from '../App'
import { db, loadSectionQuestions, type Choice, type Question, type Session } from '../db'
import BlobImg from '../components/BlobImg'

const CHOICES: Choice[] = ['A', 'B', 'C', 'D', 'E']

export default function Review({
  sessionId,
  initialIndex,
  navigate,
}: {
  sessionId: string
  initialIndex: number
  navigate: (r: Route) => void
}) {
  const [session, setSession] = useState<Session | null>(null)
  const [questions, setQuestions] = useState<Question[] | null>(null)
  const [index, setIndex] = useState(initialIndex)

  useEffect(() => {
    void (async () => {
      const s = await db.sessions.get(sessionId)
      if (!s) {
        navigate({ name: 'home' })
        return
      }
      setSession(s)
      setQuestions(await loadSectionQuestions(s.examId, s.section))
    })()
  }, [sessionId, navigate])

  if (!session || !questions) return null
  const answer = session.answers[index]
  const q = questions.find((x) => x.number === answer?.number)
  if (!answer || !q) return null

  const isCorrect = answer.choice && answer.correctChoice && answer.choice === answer.correctChoice
  const verdict = !answer.choice
    ? { text: 'Boş bırakıldı', cls: 'blank' }
    : !answer.correctChoice
      ? { text: `Cevabın: ${answer.choice}`, cls: 'nokey' }
      : isCorrect
        ? { text: 'Doğru', cls: 'ok' }
        : { text: 'Yanlış', cls: 'bad' }

  return (
    <div className="page">
      <header className="page-header row">
        <button className="btn ghost" onClick={() => navigate({ name: 'results', sessionId })}>
          ← Sonuçlar
        </button>
        <h2 className="grow center-text">
          Soru {answer.number} <span className="muted">/ {session.answers.length}</span>
        </h2>
        <span className={`verdict ${verdict.cls}`}>{verdict.text}</span>
      </header>

      <main className="review-main">
        {q.contextImages && q.contextImages.length > 0 && (
          <div className="context-box">
            <div className="context-label">Bu soru için ortak bilgi / parça</div>
            {q.contextImages.map((b, i) => (
              <BlobImg key={i} blob={b} alt="Ortak bilgi" />
            ))}
          </div>
        )}
        <div className="q-card">
          {q.images.map((b, i) => (
            <BlobImg key={i} blob={b} alt={`Soru ${q.number}`} />
          ))}
        </div>
        <div className="choices review-choices">
          {CHOICES.map((c) => {
            const cls = [
              'choice-btn',
              'static',
              answer.correctChoice === c ? 'correct' : '',
              answer.choice === c && answer.correctChoice !== c ? 'wrong' : '',
              answer.choice === c ? 'chosen' : '',
            ].join(' ')
            return (
              <span key={c} className={cls}>
                {c}
              </span>
            )
          })}
        </div>
        <div className="review-info muted">
          {answer.correctChoice ? (
            <>
              Doğru cevap: <b className="ok">{answer.correctChoice}</b>
            </>
          ) : (
            'Bu soru için cevap anahtarı yok.'
          )}
          {answer.choice && <> · Senin cevabın: <b>{answer.choice}</b></>}
          {answer.timeSpentSec > 0 && <> · Süre: {answer.timeSpentSec} sn</>}
        </div>
      </main>

      <footer className="review-nav">
        <button className="btn ghost" disabled={index === 0} onClick={() => setIndex(index - 1)}>
          ← Önceki
        </button>
        <button
          className="btn ghost"
          disabled={index >= session.answers.length - 1}
          onClick={() => setIndex(index + 1)}
        >
          Sonraki →
        </button>
      </footer>
    </div>
  )
}
