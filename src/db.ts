import Dexie, { type Table } from 'dexie'

export type Choice = 'A' | 'B' | 'C' | 'D' | 'E'

export interface SectionMeta {
  name: string
  questionCount: number
  hasAnswerKey: boolean
}

/** Kullanıcıya gösterilen ders/alan (Matematik, Türkçe, Tarih-1 …). */
export interface SubjectMeta {
  name: string
  questionCount: number
  hasAnswerKey: boolean
}

export interface Exam {
  id: string
  name: string
  createdAt: number
  /** iç numaralandırma birimleri (testler) — qid/anahtar için */
  sections: SectionMeta[]
  /** kullanıcı bölünmesi (dersler) — Home/Setup bunu gösterir */
  subjects: SubjectMeta[]
  warnings?: string[]
}

export interface Question {
  id: string // qid = `${examId}:${section}:${number}`
  examId: string
  /** test (numara alanı) adı */
  section: string
  /** ders/alan adı */
  subject: string
  number: number
  images: Blob[]
  contextImages?: Blob[]
  correct?: string
}

export interface Answer {
  /** soru kimliği (qid); numaralar testler arası tekrar ettiği için asıl anahtar budur */
  qid?: string
  /** test adı */
  section?: string
  /** ders adı */
  subject?: string
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
  /** kapsam etiketi: "Tümü" ya da ders adı */
  section: string
  /** yüklenecek ders; tanımsız = tüm dersler ("Tümü") */
  subjectFilter?: string
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

/**
 * Bir oturumun sorularını yükler. `subjectFilter` verilirse yalnızca o ders;
 * verilmezse ("Tümü") tüm sorular test sırasına (exam.sections) sonra numaraya
 * göre döner.
 */
export async function loadSessionQuestions(exam: Exam, subjectFilter?: string): Promise<Question[]> {
  let qs = await db.questions.where('examId').equals(exam.id).toArray()
  if (subjectFilter) qs = qs.filter((q) => q.subject === subjectFilter)
  const order = new Map(exam.sections.map((s, i) => [s.name, i]))
  qs.sort(
    (a, b) => (order.get(a.section) ?? 0) - (order.get(b.section) ?? 0) || a.number - b.number,
  )
  return qs
}
