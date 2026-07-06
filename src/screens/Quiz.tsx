import { useCallback, useEffect, useRef, useState } from 'react'
import type { Route } from '../App'
import { db, loadSectionQuestions, type Choice, type Question, type Session } from '../db'
import BlobImg from '../components/BlobImg'
import { formatDuration } from '../format'

const CHOICES: Choice[] = ['A', 'B', 'C', 'D', 'E']

export default function Quiz({ sessionId, navigate }: { sessionId: string; navigate: (r: Route) => void }) {
  const [session, setSession] = useState<Session | null>(null)
  const [questions, setQuestions] = useState<Question[] | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [flash, setFlash] = useState<Choice | null>(null)
  const lockedRef = useRef(false)
  const shownAtRef = useRef(Date.now())
  const finishingRef = useRef(false)

  // Yükleme
  useEffect(() => {
    void (async () => {
      const s = await db.sessions.get(sessionId)
      if (!s || s.status !== 'active') {
        navigate(s ? { name: 'results', sessionId } : { name: 'home' })
        return
      }
      const qs = await loadSectionQuestions(s.examId, s.section)
      setSession(s)
      setQuestions(qs)
      setElapsed(s.elapsedSec)
      shownAtRef.current = Date.now()
    })()
  }, [sessionId, navigate])

  const finish = useCallback(
    async (finalSession: Session, allQuestions: Question[]) => {
      if (finishingRef.current) return
      finishingRef.current = true
      // Cevaplanmamış sorular boş sayılır
      const answeredNumbers = new Set(finalSession.answers.map((a) => a.number))
      const filled = [...finalSession.answers]
      for (const q of allQuestions) {
        if (!answeredNumbers.has(q.number)) {
          filled.push({ number: q.number, choice: null, timeSpentSec: 0, correctChoice: q.correct })
        }
      }
      filled.sort((a, b) => a.number - b.number)
      const done: Session = {
        ...finalSession,
        answers: filled,
        status: 'finished',
        finishedAt: Date.now(),
      }
      await db.sessions.put(done)
      navigate({ name: 'results', sessionId: done.id })
    },
    [navigate],
  )

  // Zamanlayıcı: saniyede bir ilerler, 5 sn'de bir kalıcılaştırılır
  useEffect(() => {
    if (!session || !questions) return
    const timer = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 1
        if (next % 5 === 0) {
          void db.sessions.update(session.id, { elapsedSec: next })
        }
        if (session.mode === 'countdown' && session.durationSec && next >= session.durationSec) {
          void finish({ ...session, elapsedSec: next }, questions)
        }
        return next
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [session, questions, finish])

  const answer = useCallback(
    async (choice: Choice | null) => {
      if (!session || !questions || lockedRef.current || finishingRef.current) return
      const q = questions[session.currentIndex]
      if (!q) return
      lockedRef.current = true

      const timeSpentSec = Math.round((Date.now() - shownAtRef.current) / 1000)
      const updated: Session = {
        ...session,
        answers: [
          ...session.answers,
          { number: q.number, choice, timeSpentSec, correctChoice: q.correct },
        ],
        currentIndex: session.currentIndex + 1,
        elapsedSec: elapsed,
      }

      if (choice) {
        setFlash(choice)
        await new Promise((r) => setTimeout(r, 350))
        setFlash(null)
      }

      if (updated.currentIndex >= questions.length) {
        await finish(updated, questions)
        return
      }
      await db.sessions.put(updated)
      setSession(updated)
      shownAtRef.current = Date.now()
      lockedRef.current = false
      window.scrollTo({ top: 0 })
    },
    [session, questions, elapsed, finish],
  )

  // Klavye kısayolları: A–E / 1–5 şık, B boş bırak
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toUpperCase()
      if (k === 'B') {
        void answer(null)
        return
      }
      const byLetter = CHOICES.indexOf(k as Choice)
      const byDigit = ['1', '2', '3', '4', '5'].indexOf(e.key)
      const idx = byLetter >= 0 ? byLetter : byDigit
      if (idx >= 0) void answer(CHOICES[idx])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [answer])

  if (!session || !questions) return <div className="page center muted">Yükleniyor…</div>

  const q = questions[session.currentIndex]
  if (!q) return null

  const remaining = session.durationSec ? session.durationSec - elapsed : null
  const answered = session.answers.filter((a) => a.choice).length
  const blank = session.answers.length - answered

  const endEarly = async () => {
    if (!window.confirm('Sınavı bitirmek istediğine emin misin? Kalan sorular boş sayılacak.')) return
    await finish({ ...session, elapsedSec: elapsed }, questions)
  }

  return (
    <div className="quiz">
      <main className="quiz-main">
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
        <div className="choices">
          {CHOICES.map((c) => (
            <button
              key={c}
              className={`choice-btn ${flash === c ? 'flash' : ''}`}
              onClick={() => void answer(c)}
            >
              {c}
            </button>
          ))}
          <button className="btn ghost skip" onClick={() => void answer(null)}>
            Boş Bırak →
          </button>
        </div>
        <div className="kbd-hint muted">Klavye: A–E veya 1–5 şık seçer, B boş bırakır</div>
      </main>

      <aside className="quiz-side">
        <div className={`timer ${remaining !== null && remaining <= 300 ? 'timer-low' : ''}`}>
          <div className="timer-label">{remaining !== null ? 'Kalan Süre' : 'Geçen Süre'}</div>
          <div className="timer-value">{formatDuration(remaining !== null ? remaining : elapsed)}</div>
        </div>
        <div className="side-stat">
          <div className="side-num">
            {session.currentIndex + 1}
            <span className="muted">/{questions.length}</span>
          </div>
          <div className="side-label">Soru</div>
        </div>
        <div className="progress-track">
          <div
            className="progress-fill"
            style={{ width: `${(session.currentIndex / questions.length) * 100}%` }}
          />
        </div>
        <div className="side-counts">
          <span>
            Cevaplanan: <b>{answered}</b>
          </span>
          <span>
            Boş: <b>{blank}</b>
          </span>
        </div>
        <div className="side-note muted">Geri dönüş yok — seçim kilitlenir.</div>
        <button className="btn ghost danger" onClick={() => void endEarly()}>
          Sınavı Bitir
        </button>
      </aside>
    </div>
  )
}
