import type { Session } from './db'

export interface Score {
  correct: number
  wrong: number
  blank: number
  answered: number
  total: number
  /** ÖSYM neti: doğru − yanlış/4 */
  net: number
  hasKey: boolean
}

export function scoreSession(s: Session): Score {
  let correct = 0
  let wrong = 0
  let blank = 0
  let hasKey = false
  for (const a of s.answers) {
    if (a.correctChoice) hasKey = true
    if (!a.choice) blank++
    else if (a.correctChoice && a.choice === a.correctChoice) correct++
    else if (a.correctChoice) wrong++
  }
  const answered = s.answers.filter((a) => a.choice).length
  return {
    correct,
    wrong,
    blank,
    answered,
    total: s.answers.length,
    net: correct - wrong / 4,
    hasKey,
  }
}
