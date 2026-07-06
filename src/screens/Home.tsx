import { useCallback, useEffect, useRef, useState } from 'react'
import type { Route } from '../App'
import { db, deleteExam, questionId, type Exam, type Session } from '../db'
import { parsePdf, type ParseProgress } from '../parser/parsePdf'
import { formatDate, formatDuration } from '../format'
import { scoreSession } from '../scoring'

const PHASE_LABEL: Record<ParseProgress['phase'], string> = {
  clean: 'Filigran denetleniyor',
  read: 'PDF okunuyor',
  detect: 'Sorular tespit ediliyor',
  crop: 'Soru görselleri kırpılıyor',
}

export default function Home({ navigate }: { navigate: (r: Route) => void }) {
  const [exams, setExams] = useState<Exam[]>([])
  const [activeSessions, setActiveSessions] = useState<Session[]>([])
  const [finishedSessions, setFinishedSessions] = useState<Session[]>([])
  const [progress, setProgress] = useState<ParseProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    setExams(await db.exams.orderBy('createdAt').reverse().toArray())
    setActiveSessions(await db.sessions.where('status').equals('active').reverse().sortBy('startedAt'))
    const finished = await db.sessions.where('status').equals('finished').sortBy('startedAt')
    setFinishedSessions(finished.reverse())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleFile = async (file: File) => {
    if (progress) return
    setError(null)
    if (!/\.pdf$/i.test(file.name)) {
      setError('Lütfen bir PDF dosyası seçin.')
      return
    }
    try {
      setProgress({ phase: 'read', done: 0, total: 1 })
      const result = await parsePdf(file, setProgress)
      const examId = crypto.randomUUID()
      const exam: Exam = {
        id: examId,
        name: file.name.replace(/\.pdf$/i, ''),
        createdAt: Date.now(),
        sections: result.sections,
        warnings: result.warnings.length ? result.warnings : undefined,
      }
      await db.transaction('rw', db.exams, db.questions, async () => {
        await db.exams.add(exam)
        await db.questions.bulkAdd(
          result.questions.map((q) => ({
            id: questionId(examId, q.section, q.number),
            examId,
            section: q.section,
            number: q.number,
            images: q.images,
            contextImages: q.contextImages,
            correct: q.correct,
          })),
        )
      })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF işlenirken bir hata oluştu.')
    } finally {
      setProgress(null)
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) void handleFile(file)
  }

  const removeExam = async (exam: Exam) => {
    if (!window.confirm(`"${exam.name}" sınavı ve tüm oturumları silinsin mi?`)) return
    await deleteExam(exam.id)
    await refresh()
  }

  const removeSession = async (s: Session) => {
    if (!window.confirm('Bu oturum silinsin mi?')) return
    await db.sessions.delete(s.id)
    await refresh()
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>
          Docu<span className="accent">Quiz</span>
        </h1>
        <p className="subtitle">
          ÖSYM PDF'ini yükle, soruları tek tek çöz. Sorular arasında gezin, cevabını değiştir — süre sağda.
        </p>
      </header>

      <section
        className={`dropzone ${dragOver ? 'drag-over' : ''} ${progress ? 'busy' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !progress && fileInput.current?.click()}
      >
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f)
            e.target.value = ''
          }}
        />
        {progress ? (
          <div className="parse-progress">
            <div className="parse-label">{PHASE_LABEL[progress.phase]}…</div>
            <div className="bar">
              <div
                className="bar-fill"
                style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }}
              />
            </div>
            <div className="parse-count">
              {progress.done}/{progress.total}
            </div>
          </div>
        ) : (
          <>
            <div className="drop-icon">📄</div>
            <div className="drop-title">PDF'i buraya bırak ya da tıkla</div>
            <div className="drop-hint">İki sütunlu, çoktan seçmeli ÖSYM kitapçıkları desteklenir</div>
          </>
        )}
      </section>

      {error && <div className="error-box">{error}</div>}

      {activeSessions.length > 0 && (
        <section className="block">
          <h2>Devam Eden Sınavlar</h2>
          {activeSessions.map((s) => (
            <div key={s.id} className="card row">
              <div className="grow">
                <div className="card-title">
                  {s.examName} — {s.section}
                </div>
                <div className="muted">
                  Soru {s.currentIndex + 1} · {formatDuration(s.elapsedSec)} geçti · {formatDate(s.startedAt)}
                </div>
              </div>
              <button className="btn primary" onClick={() => navigate({ name: 'quiz', sessionId: s.id })}>
                Devam Et
              </button>
              <button className="btn ghost danger" onClick={() => void removeSession(s)}>
                Sil
              </button>
            </div>
          ))}
        </section>
      )}

      <section className="block">
        <h2>Sınavlarım</h2>
        {exams.length === 0 && <div className="muted empty">Henüz sınav yok. Yukarıdan bir PDF yükle.</div>}
        {exams.map((exam) => (
          <div key={exam.id} className="card exam-card">
            <div className="row">
              <div className="grow">
                <div className="card-title">{exam.name}</div>
                <div className="muted">{formatDate(exam.createdAt)}</div>
              </div>
              <button className="btn ghost danger" onClick={() => void removeExam(exam)}>
                Sil
              </button>
            </div>
            <div className="section-list">
              {exam.sections.map((sec) => (
                <div key={sec.name} className="section-row">
                  <div className="grow">
                    <span className="section-name">{sec.name}</span>
                    <span className="muted"> · {sec.questionCount} soru</span>
                    {sec.hasAnswerKey ? (
                      <span className="tag ok">cevap anahtarı ✓</span>
                    ) : (
                      <span className="tag warn">cevap anahtarı yok</span>
                    )}
                  </div>
                  <button
                    className="btn primary"
                    onClick={() => navigate({ name: 'setup', examId: exam.id, section: sec.name })}
                  >
                    Başlat
                  </button>
                </div>
              ))}
            </div>
            {exam.warnings && (
              <details className="warnings">
                <summary>{exam.warnings.length} uyarı</summary>
                <ul>
                  {exam.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
      </section>

      {finishedSessions.length > 0 && (
        <section className="block">
          <h2>Geçmiş Sonuçlar</h2>
          {finishedSessions.map((s) => {
            const sc = scoreSession(s)
            return (
              <div key={s.id} className="card row result-row" onClick={() => navigate({ name: 'results', sessionId: s.id })}>
                <div className="grow">
                  <div className="card-title">
                    {s.examName} — {s.section}
                  </div>
                  <div className="muted">{formatDate(s.startedAt)}</div>
                </div>
                <div className="mini-score">
                  <span className="ok">{sc.correct}D</span> <span className="bad">{sc.wrong}Y</span>{' '}
                  <span className="muted">{sc.blank}B</span>
                  {sc.hasKey && <span className="net"> · net {sc.net.toFixed(2)}</span>}
                </div>
                <div className="muted">{formatDuration(s.elapsedSec)}</div>
                <button
                  className="btn ghost danger"
                  onClick={(e) => {
                    e.stopPropagation()
                    void removeSession(s)
                  }}
                >
                  Sil
                </button>
              </div>
            )
          })}
        </section>
      )}
    </div>
  )
}
