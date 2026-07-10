import type { PageText, TextItem } from './types'
import type { BankTestInfo } from './detect'

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

/**
 * Soru bankası ÇÖZÜMLER sayfalarından cevap çıkarımı.
 * Sayfa başlığındaki "KONU Test - N" bilgisiyle eşleşen bölüme,
 * "N. Çözüm: … Doğru cevap X seçeneğidir" kalıbından cevaplar yazılır.
 */
export function parseBankAnswers(
  solutionPages: { page: PageText; info: BankTestInfo | null }[],
  warnings: string[],
): Record<string, Record<number, string>> {
  const result: Record<string, Record<number, string>> = {}
  let extracted = 0

  for (const { page, info } of solutionPages) {
    if (!info) continue // hangi teste ait olduğu okunamayan çözüm sayfası
    const sectionName = `${info.topic} · Test ${info.testNo}`
    const flat = page.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ')

    // "N. Çözüm" çapaları; her çapadan bir sonrakine kadarki bölgede "Doğru cevap X"
    const anchors: { num: number; index: number }[] = []
    const anchorRe = /(\d{1,3})\s*\.\s*Çözüm/g
    let am: RegExpExecArray | null
    while ((am = anchorRe.exec(flat))) {
      anchors.push({ num: parseInt(am[1], 10), index: am.index })
    }
    const answerRe = /Doğru (?:cevap|yanıt)[ıi]?\s*[:,]?\s*([A-E])\b/gi

    if (anchors.length) {
      for (let i = 0; i < anchors.length; i++) {
        const from = anchors[i].index
        const to = i + 1 < anchors.length ? anchors[i + 1].index : flat.length
        answerRe.lastIndex = from
        const m = answerRe.exec(flat)
        if (m && m.index < to) {
          if (!result[sectionName]) result[sectionName] = {}
          result[sectionName][anchors[i].num] = m[1].toUpperCase()
          extracted++
        }
      }
    } else {
      // çapasız düzen: sayfadaki "Doğru cevap X"leri sırayla 1..n eşle
      let n = Object.keys(result[sectionName] ?? {}).length
      let m2: RegExpExecArray | null
      answerRe.lastIndex = 0
      while ((m2 = answerRe.exec(flat))) {
        n++
        if (!result[sectionName]) result[sectionName] = {}
        result[sectionName][n] = m2[1].toUpperCase()
        extracted++
      }
    }
  }

  if (extracted === 0 && solutionPages.length > 0) {
    warnings.push('Çözüm sayfaları bulundu ama cevaplar eşleştirilemedi; puanlama yapılamayacak.')
  } else if (extracted === 0) {
    warnings.push('Cevap anahtarı / çözüm sayfası bulunamadı; puanlama yapılamayacak.')
  } else {
    warnings.push(`${extracted} cevap, çözüm sayfalarından çıkarıldı.`)
  }
  return result
}
