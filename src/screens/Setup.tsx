import { useEffect, useState } from 'react'
import type { Route } from '../App'
import { db, type Exam, type Session } from '../db'

export default function Setup({
  examId,
  initialSection,
  navigate,
}: {
  examId: string
  initialSection?: string
  navigate: (r: Route) => void
}) {
  const [exam, setExam] = useState<Exam | null>(null)
  const [section, setSection] = useState<string>('')
  const [mode, setMode] = useState<'stopwatch' | 'countdown'>('stopwatch')
  const [minutes, setMinutes] = useState(60)

  useEffect(() => {
    void db.exams.get(examId).then((e) => {
      if (!e) {
        navigate({ name: 'home' })
        return
      }
      setExam(e)
      const first = e.sections.find((s) => s.name === initialSection) ?? e.sections[0]
      if (first) {
        setSection(first.name)
        setMinutes(defaultMinutes(first.questionCount))
      }
    })
  }, [examId, initialSection, navigate])

  if (!exam) return null
  const selected = exam.sections.find((s) => s.name === section)

  const start = async () => {
    if (!selected) return
    const session: Session = {
      id: crypto.randomUUID(),
      examId: exam.id,
      examName: exam.name,
      section: selected.name,
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
        <h3>Bölüm</h3>
        <div className="option-list">
          {exam.sections.map((s) => (
            <label key={s.name} className={`option ${section === s.name ? 'selected' : ''}`}>
              <input
                type="radio"
                name="section"
                checked={section === s.name}
                onChange={() => {
                  setSection(s.name)
                  setMinutes(defaultMinutes(s.questionCount))
                }}
              />
              <span className="grow">
                {s.name} <span className="muted">· {s.questionCount} soru</span>
              </span>
              {!s.hasAnswerKey && <span className="tag warn">cevap anahtarı yok</span>}
            </label>
          ))}
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
            <input
              id="minutes"
              type="number"
              min={1}
              max={600}
              value={minutes}
              onChange={(e) => setMinutes(parseInt(e.target.value || '1', 10))}
            />
          </div>
        )}

        <div className="rule-note">
          ℹ️ Şık seçince otomatik olarak sonraki soruya geçilir. Gördüğün sorular arasında dilediğin gibi
          <b> geri dönebilir</b>, paletten atlayabilir ve <b>cevabını değiştirebilirsin</b>. Cevaplamadan
          "Sonraki" ile geçtiğin sorular boş kalır.
        </div>

        <button className="btn primary big" disabled={!selected} onClick={() => void start()}>
          Sınavı Başlat
        </button>
      </div>
    </div>
  )
}

function defaultMinutes(questionCount: number): number {
  return Math.max(5, Math.ceil(questionCount * 1.25))
}
