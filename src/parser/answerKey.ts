import type { PageText, TextItem } from './types'

// Cevap anahtarı sayfası çok sütunlu "N. X" çiftlerinden oluşur
// (örn. "1. D", "2. B" …). Numaralar her bölümde 1'den yeniden başladığı
// için, numara sıfırlanması yeni bölümün başladığını gösterir; anahtar
// bölümleri soru bölümleriyle sırayla eşleştirilir.

const NUM_RE = /^(\d{1,3})\.$/
const LETTER_RE = /^[A-E]$/

interface KeyEntry {
  num: number
  letter: string
  x: number
  top: number
  pageIndex: number
}

export function parseAnswerKey(
  keyPages: PageText[],
  sectionNames: string[],
  warnings: string[],
): Record<string, Record<number, string>> {
  const result: Record<string, Record<number, string>> = {}
  if (!keyPages.length) {
    warnings.push('Cevap anahtarı sayfası bulunamadı; puanlama yapılamayacak.')
    return result
  }

  const entries: KeyEntry[] = []
  for (const page of keyPages) {
    const numbers: TextItem[] = []
    const letters: TextItem[] = []
    for (const it of page.items) {
      const t = it.str.trim()
      if (NUM_RE.test(t)) numbers.push(it)
      else if (LETTER_RE.test(t)) letters.push(it)
    }
    for (const n of numbers) {
      // aynı satırda, hemen sağındaki harf
      let best: TextItem | undefined
      for (const l of letters) {
        const dy = Math.abs(l.top - n.top)
        const dx = l.x - (n.x + n.w)
        if (dy <= 4 && dx > -2 && dx < 60 && (!best || l.x < best.x)) best = l
      }
      if (best) {
        entries.push({
          num: parseInt(NUM_RE.exec(n.str.trim())![1], 10),
          letter: best.str.trim(),
          x: n.x,
          top: n.top,
          pageIndex: page.pageIndex,
        })
      }
    }
  }

  if (!entries.length) {
    warnings.push('Cevap anahtarı sayfası okunamadı.')
    return result
  }

  // Sütun kümeleri: x değerlerini sırala, 30pt'ten büyük boşluklarda böl
  const keyOrder: KeyEntry[] = []
  const byPage = new Map<number, KeyEntry[]>()
  for (const e of entries) {
    if (!byPage.has(e.pageIndex)) byPage.set(e.pageIndex, [])
    byPage.get(e.pageIndex)!.push(e)
  }
  for (const pageIndex of [...byPage.keys()].sort((a, b) => a - b)) {
    const pageEntries = byPage.get(pageIndex)!
    const xs = [...new Set(pageEntries.map((e) => Math.round(e.x)))].sort((a, b) => a - b)
    const colStarts: number[] = []
    for (let i = 0; i < xs.length; i++) {
      if (i === 0 || xs[i] - xs[i - 1] > 30) colStarts.push(xs[i])
    }
    const colOf = (x: number) => {
      let c = 0
      for (let i = 0; i < colStarts.length; i++) if (x >= colStarts[i] - 15) c = i
      return c
    }
    pageEntries.sort((a, b) => colOf(a.x) - colOf(b.x) || a.top - b.top)
    keyOrder.push(...pageEntries)
  }

  // Numara sıfırlanması = yeni bölüm
  const keySections: Record<number, string>[] = []
  let current: Record<number, string> | null = null
  let prevNum = Infinity
  for (const e of keyOrder) {
    if (e.num <= prevNum && e.num === 1) {
      current = {}
      keySections.push(current)
    }
    if (!current) {
      current = {}
      keySections.push(current)
    }
    current[e.num] = e.letter
    prevNum = e.num
  }

  if (keySections.length !== sectionNames.length) {
    warnings.push(
      `Cevap anahtarındaki bölüm sayısı (${keySections.length}) soru bölümleriyle (${sectionNames.length}) eşleşmiyor; sırayla eşleştirildi.`,
    )
  }
  for (let i = 0; i < Math.min(keySections.length, sectionNames.length); i++) {
    result[sectionNames[i]] = keySections[i]
  }
  return result
}
