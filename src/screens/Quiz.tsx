import { useCallback, useEffect, useRef, useState } from 'react'
import type { Route } from '../App'
import { db, loadSessionQuestions, type Answer, type Choice, type Question, type Session } from '../db'
import BlobImg from '../components/BlobImg'
import { formatDuration } from '../format'

const CHOICES: Choice[] = ['A', 'B', 'C', 'D', 'E']

/** Soruyu (qid) cevaplarda bulur ya da yeni kayıt açar; yamayla günceller. */
function upsertByQid(answers: Answer[], q: Question, patch: Partial<Answer>): Answer[] {
  const idx = answers.findIndex((a) => a.qid === q.id)
  if (idx < 0) {
    return [
      ...answers,
      {
        qid: q.id,
        section: q.section,
        subject: q.subject,
        number: q.number,
        correctChoice: q.correct,
        choice: null,
        timeSpentSec: 0,
        ...patch,
      },
    ]
  }
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
    elapsedRef.current = elapsed
  }, [elapsed])

  /** Tek noktadan durum + ref + kalıcılaştırma. */
  const commit = useCallback((updated: Session) => {
    sessionRef.current = updated
    setSession(updated)
    void db.sessions.put(updated)
  }, [])

  // Yükleme (devam eden oturumlar dahil)
  useEffect(() => {
    void (async () => {
      const s = await db.sessions.get(sessionId)
      if (!s || s.status !== 'active') {
        navigate(s ? { name: 'results', sessionId } : { name: 'home' })
        return
      }
      const exam = await db.exams.get(s.examId)
      if (!exam) {
        navigate({ name: 'home' })
        return
      }
      // Eski oturumlarda subjectFilter yok; section etiketini filtre say (Tümü hariç).
      const filter = s.subjectFilter ?? (s.section && s.section !== 'Tümü' ? s.section : undefined)
      const qs = await loadSessionQuestions(exam, filter)
      const maxSeen = Math.min(Math.max(s.maxSeenIndex ?? s.currentIndex, s.currentIndex), qs.length - 1)
      let answers = s.answers
      for (let i = 0; i <= maxSeen; i++) answers = upsertByQid(answers, qs[i], {})
      const loaded: Session = { ...s, answers, maxSeenIndex: maxSeen }
      sessionRef.current = loaded
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
      for (const q of allQuestions) answers = upsertByQid(answers, q, {})
      const done: Session = { ...finalSession, answers, status: 'finished', finishedAt: Date.now() }
      await db.sessions.put(done)
      navigate({ name: 'results', sessionId: done.id })
    },
    [navigate],
  )

  // Zamanlayıcı
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

  /** Görülen sorular arasında geçiş (bir sonraki yeni soru da serbest). */
  const goTo = useCallback(
    (index: number) => {
      const s = sessionRef.current
      if (!s || !questions || finishingRef.current) return
      if (index < 0 || index >= questions.length || index === s.currentIndex) return
      const maxSeen = Math.max(s.maxSeenIndex ?? s.currentIndex, s.currentIndex)
      if (index > maxSeen + 1) return

      const curQ = questions[s.currentIndex]
      const dwell = Math.round((Date.now() - shownAtRef.current) / 1000)
      let answers = upsertByQid(s.answers, curQ, {})
      answers = answers.map((a) => (a.qid === curQ.id ? { ...a, timeSpentSec: a.timeSpentSec + dwell } : a))
      answers = upsertByQid(answers, questions[index], {})

      commit({
        ...s,
        answers,
        currentIndex: index,
        maxSeenIndex: Math.max(maxSeen, index),
        elapsedSec: elapsedRef.current,
      })
      shownAtRef.current = Date.now()
      window.scrollTo({ top: 0 })
    },
    [questions, commit],
  )

  /** Şık seç / temizle. Seçim her zaman değiştirilebilir. */
  const setChoice = useCallback(
    (choice: Choice | null) => {
      const s = sessionRef.current
      if (!s || !questions || finishingRef.current) return
      const q = questions[s.currentIndex]
      commit({ ...s, answers: upsertByQid(s.answers, q, { choice }), elapsedSec: elapsedRef.current })
    },
    [questions, commit],
  )

  /** Şık seçince: kısa vurgu → otomatik sonraki soru. */
  const choose = useCallback(
    (choice: Choice) => {
      setChoice(choice)
      setFlash(choice)
      if (advanceTimer.current) window.clearTimeout(advanceTimer.current)
      advanceTimer.current = window.setTimeout(() => {
        setFlash(null)
        const cur = sessionRef.current
        if (cur && questions && cur.currentIndex < questions.length - 1) goTo(cur.currentIndex + 1)
      }, 320)
    },
    [setChoice, goTo, questions],
  )

  /** Boş Bırak: mevcut seçimi kaldır ve sonraki soruya geç. */
  const leaveBlank = useCallback(() => {
    setChoice(null)
    const cur = sessionRef.current
    if (cur && questions && cur.currentIndex < questions.length - 1) goTo(cur.currentIndex + 1)
  }, [setChoice, goTo, questions])

  // Klavye: A–E / 1–5 şık, ←/→ gezinme
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') return goTo((sessionRef.current?.currentIndex ?? 0) - 1)
      if (e.key === 'ArrowRight') return goTo((sessionRef.current?.currentIndex ?? 0) + 1)
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
  const current = session.answers.find((a) => a.qid === q.id)
  const maxSeen = Math.max(session.maxSeenIndex ?? session.currentIndex, session.currentIndex)
  const remaining = session.durationSec ? session.durationSec - elapsed : null
  const answered = session.answers.filter((a) => a.choice).length
  const blank = maxSeen + 1 - answered

  // Palet: birden çok ders varsa gruplu göster
  const palGroups: { subject: string; idx: number[] }[] = []
  questions.forEach((qq, i) => {
    const last = palGroups[palGroups.length - 1]
    if (last && last.subject === qq.subject) last.idx.push(i)
    else palGroups.push({ subject: qq.subject, idx: [i] })
  })
  const grouped = palGroups.length > 1

  const endEarly = async () => {
    if (!window.confirm('Sınavı bitirmek istediğine emin misin? Cevaplanmamış sorular boş sayılacak.')) return
    await finish({ ...session, elapsedSec: elapsed }, questions)
  }

  const palCell = (i: number) => {
    const qq = questions[i]
    const a = session.answers.find((x) => x.qid === qq.id)
    const cls = [
      'pal-cell',
      i === session.currentIndex ? 'current' : '',
      a?.choice ? 'answered' : i <= maxSeen ? 'seen' : '',
    ].join(' ')
    return (
      <button
        key={qq.id}
        className={cls}
        disabled={i > maxSeen + 1}
        title={i > maxSeen + 1 ? 'Henüz görülmedi' : `${qq.subject} ${qq.number}${a?.choice ? ` — ${a.choice}` : ''}`}
        onClick={() => goTo(i)}
      >
        {qq.number}
      </button>
    )
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
          <button className="btn ghost nav-btn" disabled={session.currentIndex === 0} onClick={() => goTo(session.currentIndex - 1)}>
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
          <button className="btn ghost clear-btn" onClick={leaveBlank}>
            Boş Bırak
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
        <div className="side-scope muted">{session.section}</div>
        <div className="side-stat">
          <div className="side-num">
            {session.currentIndex + 1}
            <span className="muted">/{questions.length}</span>
          </div>
          <div className="side-label">Soru · {q.subject}</div>
        </div>
        <div className="side-counts">
          <span>
            Cevaplanan: <b>{answered}</b>
          </span>
          <span>
            Boş: <b>{blank}</b>
          </span>
        </div>
        {grouped ? (
          <div className="palette-groups">
            {palGroups.map((g) => (
              <div key={g.subject} className="pal-group">
                <div className="pal-group-head">{g.subject}</div>
                <div className="palette">{g.idx.map(palCell)}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="palette">{questions.map((_, i) => palCell(i))}</div>
        )}
        <div className="side-note muted">Gördüğün sorular arasında gezinebilir, cevabını değiştirebilirsin.</div>
        <button className="btn danger-outline" onClick={() => void endEarly()}>
          Sınavı Bitir
        </button>
      </aside>
    </div>
  )
}
