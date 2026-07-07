import { useEffect, useState } from 'react'
import type { Route } from '../App'
import { db, type Session } from '../db'
import { scoreSession } from '../scoring'
import { formatDuration } from '../format'

export default function Results({ sessionId, navigate }: { sessionId: string; navigate: (r: Route) => void }) {
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    void db.sessions.get(sessionId).then((s) => {
      if (!s) navigate({ name: 'home' })
      else setSession(s)
    })
  }, [sessionId, navigate])

  if (!session) return null
  const sc = scoreSession(session)
  const avg = sc.total ? session.elapsedSec / sc.total : 0

  const stateOf = (i: number): 'ok' | 'bad' | 'blank' | 'nokey' => {
    const a = session.answers[i]
    if (!a?.choice) return 'blank'
    if (!a.correctChoice) return 'nokey'
    return a.choice === a.correctChoice ? 'ok' : 'bad'
  }

  return (
    <div className="page narrow">
      <header className="page-header">
        <button className="btn ghost" onClick={() => navigate({ name: 'home' })}>
          ← Ana Sayfa
        </button>
        <h1>Sonuç</h1>
        <p className="subtitle">
          {session.examName} — {session.section}
        </p>
      </header>

      <div className="card score-card">
        {sc.hasKey ? (
          <div className="score-grid">
            <div className="score-item ok">
              <div className="score-num">{sc.correct}</div>
              <div className="score-label">Doğru</div>
            </div>
            <div className="score-item bad">
              <div className="score-num">{sc.wrong}</div>
              <div className="score-label">Yanlış</div>
            </div>
            <div className="score-item">
              <div className="score-num">{sc.blank}</div>
              <div className="score-label">Boş</div>
            </div>
            <div className="score-item net">
              <div className="score-num">{sc.net.toFixed(2)}</div>
              <div className="score-label">Net</div>
            </div>
          </div>
        ) : (
          <div className="score-grid">
            <div className="score-item">
              <div className="score-num">{sc.answered}</div>
              <div className="score-label">Cevaplanan</div>
            </div>
            <div className="score-item">
              <div className="score-num">{sc.blank}</div>
              <div className="score-label">Boş</div>
            </div>
          </div>
        )}
        {sc.hasKey && sc.total > 0 && (
          <>
            <div className="dist-bar" role="img" aria-label={`${sc.correct} doğru, ${sc.wrong} yanlış, ${sc.blank} boş`}>
              {sc.correct > 0 && <div className="dist-seg ok" style={{ flex: sc.correct }} />}
              {sc.wrong > 0 && <div className="dist-seg bad" style={{ flex: sc.wrong }} />}
              {sc.blank > 0 && <div className="dist-seg blank" style={{ flex: sc.blank }} />}
            </div>
            <div className="dist-legend">
              <span>
                <i className="dist-dot ok" /> Doğru <b>{sc.correct}</b>
              </span>
              <span>
                <i className="dist-dot bad" /> Yanlış <b>{sc.wrong}</b>
              </span>
              <span>
                <i className="dist-dot blank" /> Boş <b>{sc.blank}</b>
              </span>
            </div>
          </>
        )}
        <div className="score-meta muted">
          Toplam süre: <b>{formatDuration(session.elapsedSec)}</b> · Soru başına ort.{' '}
          <b>{formatDuration(avg)}</b>
          {!sc.hasKey && ' · Bu bölüm için cevap anahtarı bulunamadığından puanlama yapılamadı.'}
        </div>
      </div>

      <div className="card">
        <h3>Sorular</h3>
        <div className="q-grid">
          {session.answers.map((a, i) => (
            <button
              key={a.number}
              className={`q-cell ${stateOf(i)}`}
              title={`Soru ${a.number}${a.choice ? ` — cevabın: ${a.choice}` : ' — boş'}`}
              onClick={() => navigate({ name: 'review', sessionId, index: i })}
            >
              {a.number}
            </button>
          ))}
        </div>
        <div className="legend muted">
          <span className="q-cell ok mini" /> doğru <span className="q-cell bad mini" /> yanlış{' '}
          <span className="q-cell blank mini" /> boş
        </div>
      </div>

      <div className="row gap">
        <button className="btn primary big grow" onClick={() => navigate({ name: 'review', sessionId, index: 0 })}>
          Soruları İncele
        </button>
        <button className="btn ghost big" onClick={() => navigate({ name: 'setup', examId: session.examId })}>
          Tekrar Çöz
        </button>
      </div>
    </div>
  )
}
