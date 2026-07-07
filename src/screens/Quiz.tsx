import { useCallback, useEffect, useRef, useState } from 'react'
import type { Route } from '../App'
import { db, loadSectionQuestions, type Answer, type Choice, type Question, type Session } from '../db'
import BlobImg from '../components/BlobImg'
import { formatDuration } from '../format'

const CHOICES: Choice[] = ['A', 'B', 'C', 'D', 'E']

/** Görülen soru için kayıt ekler ya da mevcut kaydı yamayla günceller. */
function upsertAnswer(answers: Answer[], number: number, patch: Partial<Answer>): Answer[] {
  const idx = answers.findIndex((a) => a.number === number)
  if (idx < 0) return [...answers, { number, choice: null, timeSpentSec: 0, ...patch }]
  const copy = [...answers]
  copy[idx] = { ...copy[idx], ...patch }
  return copy
}

export default function Quiz({ sessionId, navigate }: { sessionId: string; navigate: (r: Route) => void }) {
  const [session, setSession] = useState<Session | null>(null)
  const [questions, setQuestions] = useState<Question[] | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [flash, setFlash] = useState<Choice | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const elapsedRef = useRef(0)
  const shownAtRef = useRef(Date.now())
  const finishingRef = useRef(false)
  const advanceTimer = useRef<number | null>(null)

  useEffect(() => {
    sessionRef.current = session
  }, [session])
  useEffect(() => {
    elapsedRef.current = elapsed
  }, [elapsed])

  // Yükleme (devam eden oturumlar dahil)
  useEffect(() => {
    void (async () => {
      const s = await db.sessions.get(sessionId)
      if (!s || s.status !== 'active') {
        navigate(s ? { name: 'results', sessionId } : { name: 'home' })
        return
      }
      const qs = await loadSectionQuestions(s.examId, s.section)
      const maxSeen = Math.min(Math.max(s.maxSeenIndex ?? s.currentIndex, s.currentIndex), qs.length - 1)
      // görülen her soru için kayıt garantile (eski oturumları da taşır)
      let answers = s.answers
      for (let i = 0; i <= maxSeen; i++) {
        answers = upsertAnswer(answers, qs[i].number, { correctChoice: qs[i].correct })
      }
      const loaded: Session = { ...s, answers, maxSeenIndex: maxSeen }
      setSession(loaded)
      setQuestions(qs)
      setElapsed(s.elapsedSec)
      shownAtRef.current = Date.now()
    })()
  }, [sessionId, navigate])

  const finish = useCallback(
    async (finalSession: Session, allQuestions: Question[]) => {
      if (finishingRef.current) return
      finishingRef.current = true
      let answers = finalSession.answers
      for (const q of allQuestions) {
        answers = upsertAnswer(answers, q.number, { correctChoice: q.correct })
      }
      answers = [...answers].sort((a, b) => a.number - b.number)
      const done: Session = {
        ...finalSession,
        answers,
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
        const s = sessionRef.current
        if (s && next % 5 === 0) void db.sessions.update(s.id, { elapsedSec: next })
        if (s && s.mode === 'countdown' && s.durationSec && next >= s.durationSec) {
          void finish({ ...s, elapsedSec: next }, questions)
        }
        return next
      })
    }, 1000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, questions, finish])

  /** Görülen sorular arasında geçiş; bir sonraki (yeni) soruya ilerlemek de serbest. */
  const goTo = useCallback(
    (index: number) => {
      const s = sessionRef.current
      if (!s || !questions || finishingRef.current) return
      if (index < 0 || index >= questions.length || index === s.currentIndex) return
      const maxSeen = Math.max(s.maxSeenIndex ?? s.currentIndex, s.currentIndex)
      if (index > maxSeen + 1) return // görülmemiş sorulara atlanamaz

      // mevcut soruda geçirilen süreyi işle
      const curQ = questions[s.currentIndex]
      const dwell = Math.round((Date.now() - shownAtRef.current) / 1000)
      let answers = upsertAnswer(s.answers, curQ.number, { correctChoice: curQ.correct })
      answers = answers.map((a) =>
        a.number === curQ.number ? { ...a, timeSpentSec: a.timeSpentSec + dwell } : a,
      )
      // hedef soruyu görülmüş say
      const target = questions[index]
      answers = upsertAnswer(answers, target.number, { correctChoice: target.correct })

      const updated: Session = {
        ...s,
        answers,
        currentIndex: index,
        maxSeenIndex: Math.max(maxSeen, index),
        elapsedSec: elapsedRef.current,
      }
      setSession(updated)
      void db.sessions.put(updated)
      shownAtRef.current = Date.now()
      window.scrollTo({ top: 0 })
    },
    [questions],
  )

  /** Şık seç ya da temizle (null). Seçim her zaman değiştirilebilir. */
  const choose = useCallback(
    (choice: Choice | null) => {
      const s = sessionRef.current
      if (!s || !questions || finishingRef.current) return
      const q = questions[s.currentIndex]
      const answers = upsertAnswer(s.answers, q.number, { choice, correctChoice: q.correct })
      const updated: Session = { ...s, answers, elapsedSec: elapsedRef.current }
      setSession(updated)
      void db.sessions.put(updated)
      if (choice) {
        // kısa vurgu, sonra otomatik ileri ("şıkladıkça ileri")
        setFlash(choice)
        if (advanceTimer.current) window.clearTimeout(advanceTimer.current)
        advanceTimer.current = window.setTimeout(() => {
          setFlash(null)
          const cur = sessionRef.current
          if (cur && cur.currentIndex < questions.length - 1) goTo(cur.currentIndex + 1)
        }, 320)
      }
    },
    [questions, goTo],
  )

  // Klavye: A–E / 1–5 şık, ←/→ gezinme
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        goTo((sessionRef.current?.currentIndex ?? 0) - 1)
        return
      }
      if (e.key === 'ArrowRight') {
        goTo((sessionRef.current?.currentIndex ?? 0) + 1)
        return
      }
      const k = e.key.toUpperCase()
      const byLetter = CHOICES.indexOf(k as Choice)
      const byDigit = ['1', '2', '3', '4', '5'].indexOf(e.key)
      const idx = byLetter >= 0 ? byLetter : byDigit
      if (idx >= 0) choose(CHOICES[idx])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [choose, goTo])

  if (!session || !questions) return <div className="page center muted">Yükleniyor…</div>

  const q = questions[session.currentIndex]
  if (!q) return null
  const current = session.answers.find((a) => a.number === q.number)
  const maxSeen = Math.max(session.maxSeenIndex ?? session.currentIndex, session.currentIndex)

  const remaining = session.durationSec ? session.durationSec - elapsed : null
  const answered = session.answers.filter((a) => a.choice).length
  const blank = maxSeen + 1 - answered

  const endEarly = async () => {
    if (!window.confirm('Sınavı bitirmek istediğine emin misin? Cevaplanmamış sorular boş sayılacak.')) return
    await finish({ ...session, elapsedSec: elapsed }, questions)
  }

  return (
    <div className="quiz">
      <main className="quiz-main">
        <div className="q-fade" key={session.currentIndex}>
          {q.contextImages && q.contextImages.length > 0 && (
            <div className="context-box">
              <div className="context-label">Ortak bilgi / parça</div>
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
        </div>
        <div className="choices">
          <button
            className="btn ghost nav-btn"
            disabled={session.currentIndex === 0}
            onClick={() => goTo(session.currentIndex - 1)}
          >
            ← Önceki
          </button>
          {CHOICES.map((c) => (
            <button
              key={c}
              className={`choice-btn ${current?.choice === c ? 'selected' : ''} ${flash === c ? 'flash' : ''}`}
              onClick={() => choose(c)}
            >
              {c}
            </button>
          ))}
          <button className="btn ghost clear-btn" disabled={!current?.choice} onClick={() => choose(null)}>
            Temizle
          </button>
          <button
            className="btn ghost nav-btn"
            disabled={session.currentIndex >= questions.length - 1}
            onClick={() => goTo(session.currentIndex + 1)}
          >
            Sonraki →
          </button>
        </div>
        <div className="kbd-hint muted">
          Klavye: A–E / 1–5 şık seçer (seçim değiştirilebilir), ← → sorular arasında gezinir
        </div>
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
        <div className="side-counts">
          <span>
            Cevaplanan: <b>{answered}</b>
          </span>
          <span>
            Boş: <b>{blank}</b>
          </span>
        </div>
        <div className="palette">
          {questions.map((qq, i) => {
            const a = session.answers.find((x) => x.number === qq.number)
            const cls = [
              'pal-cell',
              i === session.currentIndex ? 'current' : '',
              a?.choice ? 'answered' : i <= maxSeen ? 'seen' : '',
            ].join(' ')
            return (
              <button
                key={qq.number}
                className={cls}
                disabled={i > maxSeen + 1}
                title={i > maxSeen + 1 ? 'Henüz görülmedi' : `Soru ${qq.number}${a?.choice ? ` — ${a.choice}` : ''}`}
                onClick={() => goTo(i)}
              >
                {qq.number}
              </button>
            )
          })}
        </div>
        <div className="side-note muted">Gördüğün sorular arasında gezinebilir, cevabını değiştirebilirsin.</div>
        <button className="btn danger-outline" onClick={() => void endEarly()}>
          Sınavı Bitir
        </button>
      </aside>
    </div>
  )
}
