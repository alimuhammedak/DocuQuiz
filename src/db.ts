import Dexie, { type Table } from 'dexie'

export type Choice = 'A' | 'B' | 'C' | 'D' | 'E'

export interface SectionMeta {
  name: string
  questionCount: number
  hasAnswerKey: boolean
}

export interface Exam {
  id: string
  name: string
  createdAt: number
  sections: SectionMeta[]
  warnings?: string[]
}

export interface Question {
  id: string // `${examId}:${section}:${number}`
  examId: string
  section: string
  number: number
  images: Blob[]
  contextImages?: Blob[]
  correct?: string
}

export interface Answer {
  number: number
  /** null = boş (görüldü ama işaretlenmedi) */
  choice: Choice | null
  timeSpentSec: number
  /** cevap anahtarı varsa sorunun doğru şıkkı */
  correctChoice?: string
}

export interface Session {
  id: string
  examId: string
  examName: string
  section: string
  mode: 'stopwatch' | 'countdown'
  durationSec?: number
  startedAt: number
  finishedAt?: number
  elapsedSec: number
  currentIndex: number
  /** görülen en ileri soru indexi; öğrenci 0..maxSeenIndex arasında gezinebilir */
  maxSeenIndex?: number
  /** görülen her soru için bir kayıt; seçim değiştirilebilir */
  answers: Answer[]
  status: 'active' | 'finished'
}

class DocuQuizDB extends Dexie {
  exams!: Table<Exam, string>
  questions!: Table<Question, string>
  sessions!: Table<Session, string>

  constructor() {
    super('docuquiz')
    this.version(1).stores({
      exams: 'id, createdAt',
      questions: 'id, examId, [examId+section]',
      sessions: 'id, examId, status, startedAt',
    })
  }
}

export const db = new DocuQuizDB()

export function questionId(examId: string, section: string, number: number): string {
  return `${examId}:${section}:${number}`
}

export async function deleteExam(examId: string): Promise<void> {
  await db.transaction('rw', db.exams, db.questions, db.sessions, async () => {
    await db.questions.where('examId').equals(examId).delete()
    await db.sessions.where('examId').equals(examId).delete()
    await db.exams.delete(examId)
  })
}

export async function loadSectionQuestions(examId: string, section: string): Promise<Question[]> {
  const qs = await db.questions.where('[examId+section]').equals([examId, section]).toArray()
  qs.sort((a, b) => a.number - b.number)
  return qs
}
