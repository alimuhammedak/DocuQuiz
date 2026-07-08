import { useEffect, useState } from 'react'
import type { Route, Scope } from '../App'
import { db, type Exam, type Session } from '../db'

export default function Setup({
  examId,
  scope,
  navigate,
}: {
  examId: string
  scope: Scope
  navigate: (r: Route) => void
}) {
  const [exam, setExam] = useState<Exam | null>(null)
  const [mode, setMode] = useState<'stopwatch' | 'countdown'>('stopwatch')
  const [minutes, setMinutes] = useState(60)

  useEffect(() => {
    void db.exams.get(examId).then((e) => {
      if (!e) {
        navigate({ name: 'home' })
        return
      }
      setExam(e)
      const subjects = e.subjects?.length ? e.subjects : e.sections
      const count = scope.subjectFilter
        ? subjects.find((s) => s.name === scope.subjectFilter)?.questionCount ?? 0
        : subjects.reduce((n, s) => n + s.questionCount, 0)
      setMinutes(defaultMinutes(count))
    })
  }, [examId, scope.subjectFilter, navigate])

  if (!exam) return null
  const subjects = exam.subjects?.length ? exam.subjects : exam.sections
  const count = scope.subjectFilter
    ? subjects.find((s) => s.name === scope.subjectFilter)?.questionCount ?? 0
    : subjects.reduce((n, s) => n + s.questionCount, 0)

  const start = async () => {
    const session: Session = {
      id: crypto.randomUUID(),
      examId: exam.id,
      examName: exam.name,
      section: scope.label,
      subjectFilter: scope.subjectFilter,
      mode,
      durationSec: mode === 'countdown' ? Math.max(1, minutes) * 60 : undefined,
      startedAt: Date.now(),
      elapsedSec: 0,
      currentIndex: 0,
      answers: [],
      status: 'active',
    }
    await db.sessions.add(session)
    navigate({ name: 'quiz', sessionId: session.id })
  }

  return (
    <div className="page narrow">
      <header className="page-header">
        <button className="btn ghost" onClick={() => navigate({ name: 'home' })}>
          ← Ana Sayfa
        </button>
        <h1>{exam.name}</h1>
        <p className="subtitle">Sınav ayarları</p>
      </header>

      <div className="card setup-card">
        <h3>Kapsam</h3>
        <div className="scope-banner">
          <span className="scope-banner-label">{scope.label}</span>
          <span className="muted"> · {count} soru</span>
        </div>

        <h3>Süre</h3>
        <div className="option-list">
          <label className={`option ${mode === 'stopwatch' ? 'selected' : ''}`}>
            <input type="radio" name="mode" checked={mode === 'stopwatch'} onChange={() => setMode('stopwatch')} />
            <span className="grow">
              Kronometre <span className="muted">· geçen süre sayılır, sınır yok</span>
            </span>
          </label>
          <label className={`option ${mode === 'countdown' ? 'selected' : ''}`}>
            <input type="radio" name="mode" checked={mode === 'countdown'} onChange={() => setMode('countdown')} />
            <span className="grow">
              Geri sayım <span className="muted">· süre bitince sınav otomatik biter</span>
            </span>
          </label>
        </div>
        {mode === 'countdown' && (
          <div className="duration-row">
            <label htmlFor="minutes">Süre (dakika):</label>
            <div className="stepper">
              <button type="button" aria-label="Azalt" onClick={() => setMinutes((m) => Math.max(1, m - 5))}>
                −
              </button>
              <input
                id="minutes"
                type="number"
                min={1}
                max={600}
                value={minutes}
                onChange={(e) => setMinutes(Math.max(1, Math.min(600, parseInt(e.target.value || '1', 10))))}
              />
              <button type="button" aria-label="Artır" onClick={() => setMinutes((m) => Math.min(600, m + 5))}>
                +
              </button>
            </div>
          </div>
        )}

        <div className="rule-note">
          ℹ️ Şık seçince otomatik olarak sonraki soruya geçilir. Gördüğün sorular arasında dilediğin gibi
          <b> geri dönebilir</b>, paletten atlayabilir ve <b>cevabını değiştirebilirsin</b>. Cevaplamadan
          "Sonraki" ile geçtiğin sorular boş kalır.
        </div>

        <button className="btn primary big" disabled={count === 0} onClick={() => void start()}>
          Sınavı Başlat
        </button>
      </div>
    </div>
  )
}

function defaultMinutes(questionCount: number): number {
  return Math.max(5, Math.ceil(questionCount * 1.25))
}
