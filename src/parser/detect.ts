import type {
  Detection,
  DetectedGroup,
  DetectedQuestion,
  PageText,
  Region,
  SectionInfo,
  SubjectInfo,
  TextItem,
} from './types'
import { parseAnswerKey, parseBankAnswers } from './answerKey'

// ÖSYM kitapçıkları iki sütunlu dizilir; soru numaraları ("1.", "2." …)
// sütunun sol kenarına hizalıdır. Tespit stratejisi:
//  1. Bölüm başlangıç sayfalarını ve cevap anahtarı sayfalarını sınıflandır.
//  2. Her bölümde sütunları okuma sırasıyla (sol->sağ, sayfa sırası) tara;
//     sütun kenarına hizalı "N." öğeleri ile "N. - M. soruları ..." grup
//     talimatlarını sınır adayı olarak topla.
//  3. Beklenen soru numarası sayacıyla yürü: içerikteki sahte numaralar elenir.
//  4. İki sınır arasındaki bölge(ler) o sorunun/grubun kırpma alanıdır.

const QNUM_RE = /^(\d{1,3})\.$/
// "38. - 39. soruları", "1 ve 2. soruları", "3 – 5. soruları", "1 − 4. ..." (U+2212)
const GROUP_RE = /^(\d{1,3})\s*\.?\s*(?:[-–−]|ve|ile)\s*(\d{1,3})\s*\.?\s*sorular/i
// Test/bölüm başlangıç sayfası işaretçisi (sayfa sınıflandırma için).
const SECTION_MARK_RE = /BU BÖLÜMDE|CEVAPLAYACAĞINIZ|Bu testte|SORU (SAYISI|VARDIR)/i
// Test-başı sayfada talimat bloğunu (ve içindeki sahte "1."/"2." kurallarını)
// soru alanından dışlamak için üst-sınır (topBound) satır kalıbı.
const INSTR_LINE_RE =
  /BU BÖLÜMDE|CEVAPLAYACAĞINIZ|Bu testte|SORU (SAYISI|VARDIR)|Cevaplarınızı|işaretleyiniz|alanlar[ıi]na ait/i
const END_RE = /TEST BİTTİ|SINAV BİTTİ|BÖLÜM BİTTİ|CEVAPLARINIZI KONTROL/
const FOOTER_RE = /Diğer sayfaya geçiniz/i

// Yayınevi soru bankası düzeni: "KONU ADI  (Çözümlü) Test - N" başlıklı sayfalar.
const BANK_TEST_RE =
  /([A-ZÇĞİÖŞÜÂÎÛ0-9\-'’ ]{3,60}?)\s*(?:Çözümlü\s+)?Test\s*[-–−]\s*(\d{1,3})\b/u

export interface BankTestInfo {
  topic: string
  testNo: number
  isSolutions: boolean
}

/** ÇÖZÜMLER sayfası mı? (Test başlığı olmasa bile) */
export function isSolutionsPage(page: PageText): boolean {
  // Not: \b Türkçe harflerle (Ç) çalışmaz; düz arama kullanılır.
  const flat = joinPageText(page).replace(/\s+/g, ' ')
  return flat.includes('ÇÖZÜMLER') || (flat.match(/Çözüm\s*:/g) ?? []).length >= 2
}

/** Sayfa bir soru bankası test/çözüm sayfası mı? */
export function bankTestOf(page: PageText): BankTestInfo | null {
  const flat = joinPageText(page).replace(/\s+/g, ' ')
  const m = BANK_TEST_RE.exec(flat)
  if (!m) return null
  let topic = m[1]
    .replace(/^\d+\s*/, '') // baştaki sayfa numarası
    .replace(/^BÖLÜM\s*\d+\s*/iu, '')
    .replace(/^[A-ZÇĞİÖŞÜ]+\s+BÖLÜMÜ?\s+/u, '') // "SÖZEL BÖLÜM" gibi üst kuşak adı
    .replace(/ÇÖZÜMLER/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  // üst bantta konu adı iki kez geçebiliyor; birebir tekrarı sadeleştir
  const half = Math.floor(topic.length / 2)
  if (topic.length > 8 && topic.slice(0, half).trim() === topic.slice(half).trim()) {
    topic = topic.slice(0, half).trim()
  }
  if (!topic) return null
  return { topic, testNo: parseInt(m[2], 10), isSolutions: isSolutionsPage(page) }
}

interface Line {
  top: number
  bottom: number
  x: number
  text: string
  items: TextItem[]
}

export function joinPageText(page: PageText): string {
  return page.items.map((i) => i.str).join(' ')
}

/** Öğeleri satırlara grupla (aynı taban çizgisi ~3pt tolerans). */
export function buildLines(items: TextItem[]): Line[] {
  const sorted = [...items].sort((a, b) => a.top - b.top || a.x - b.x)
  const lines: Line[] = []
  for (const it of sorted) {
    if (!it.str.trim()) continue
    const last = lines[lines.length - 1]
    if (last && Math.abs(it.top - last.top) <= 3) {
      last.items.push(it)
      last.bottom = Math.max(last.bottom, it.bottom)
    } else {
      lines.push({ top: it.top, bottom: it.bottom, x: it.x, text: '', items: [it] })
    }
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x)
    l.x = l.items[0].x
    l.text = l.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim()
  }
  return lines
}

function isAnswerKeyPage(page: PageText): boolean {
  const text = joinPageText(page)
  const matches = text.match(/\b\d{1,3}\s*\.\s+[A-E]\b/g)
  return (matches?.length ?? 0) >= 20
}

function columnOf(item: TextItem, pageWidth: number): 0 | 1 {
  const center = item.x + item.w / 2
  return center < pageWidth / 2 ? 0 : 1
}

interface Boundary {
  kind: 'question' | 'group' | 'end'
  pageIndex: number
  col: 0 | 1
  top: number
  num?: number
  groupEnd?: number
}

interface PageLayout {
  topBound: number
  footBound: number
  lines: [Line[], Line[]]
}

function layoutPage(page: PageText, isSectionStart: boolean, bankTopic?: string): PageLayout {
  const H = page.height
  let topBound = H * (bankTopic ? 0.05 : 0.08)
  let footBound = H * 0.87
  const cols: [Line[], Line[]] = [[], []]
  const colItems: [TextItem[], TextItem[]] = [[], []]
  for (const it of page.items) colItems[columnOf(it, page.width)].push(it)
  cols[0] = buildLines(colItems[0])
  cols[1] = buildLines(colItems[1])

  let sawFooter = false
  let bottomLine: Line | null = null
  for (const col of cols) {
    for (const line of col) {
      if (FOOTER_RE.test(line.text)) {
        footBound = Math.min(footBound, line.top - 4)
        sawFooter = true
      }
      if (!bottomLine || line.top > bottomLine.top) bottomLine = line
      if (isSectionStart && line.top < H * 0.4 && INSTR_LINE_RE.test(line.text)) {
        topBound = Math.max(topBound, line.bottom + 8)
      }
      // Soru bankası: üst banttaki konu adı / "BÖLÜM N" / sayfa no satırları
      // soru alanı dışıdır.
      if (bankTopic && line.top < H * 0.18) {
        const t = line.text.trim()
        if (
          /^BÖLÜM\s*\d+$/i.test(t) ||
          /^\d{1,4}$/.test(t) ||
          /karekodu okutunuz/i.test(t) ||
          (t.length > 3 && (t === bankTopic || bankTopic.includes(t) || t.includes(bankTopic)))
        ) {
          topBound = Math.max(topBound, line.bottom + 8)
        }
      }
    }
  }
  // "Diğer sayfaya geçiniz" yoksa (soru bankaları): en alttaki satır yalnızca
  // sayfa numarasıysa onun üstü, değilse sayfanın ~%96,5'i içerik alanıdır.
  if (!sawFooter) {
    footBound =
      bottomLine && /^\d{1,4}$/.test(bottomLine.text.trim())
        ? Math.min(H * 0.965, bottomLine.top - 4)
        : H * 0.965
  }
  return { topBound, footBound, lines: cols }
}

interface SubArea {
  name: string
  start: number
  end: number
}

/**
 * Test-başı talimatından dersleri çıkarır:
 *  "Bu testte sırasıyla Türk Dili ve Edebiyatı (1-24), Tarih-1 (25-34) …
 *   alanlarına ait toplam N soru vardır."  → [{Türk Dili…,1,24},{Tarih-1,25,34},…]
 * Tek ders ise (sırasıyla listesi yok) rule-2'den ("cevap kâğıdının X Testi için")
 * ders adı alınır.
 */
function parseSubjects(pageText: string): { subAreas: SubArea[]; singleName?: string } {
  const flat = pageText.replace(/\s+/g, ' ')
  const subAreas: SubArea[] = []
  const seg = /sırasıyla(.+?)alanlar[ıi]na ait/i.exec(flat)
  if (seg) {
    const re = /([^,()]+?)\s*\((\d+)\s*[-–]\s*(\d+)\)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(seg[1]))) {
      let name = m[1].trim()
      // "… almak zorunda olmayan … için Felsefe Grubu" gibi açıklamalı adlarda
      // gerçek ders adı son "için"den sonra gelir.
      if (/ için /i.test(name)) name = name.split(/ için /i).pop()!.trim()
      name = name.replace(/^[\s,;.:-]+|[\s,;.:-]+$/g, '')
      if (name && name.length <= 60) subAreas.push({ name, start: +m[2], end: +m[3] })
    }
  }
  let singleName: string | undefined
  const r2 = /cevap k[âa]ğıdının\s+(.+?)\s+Test[İi]\s+için/i.exec(flat)
  if (r2) singleName = r2[1].trim()
  return { subAreas, singleName }
}

/** Test (numara alanı) görünen adı: rule-2 > başlık > "Test i". */
function extractSectionName(page: PageText, fallbackIndex: number): string {
  const flat = joinPageText(page).replace(/\s+/g, ' ')
  const r2 = /cevap k[âa]ğıdının\s+(.+?)\s+Test[İi]\s+için/i.exec(flat)
  if (r2) return r2[1].trim()
  for (const line of buildLines(page.items)) {
    if (line.top > page.height * 0.4) break
    for (const it of line.items) {
      const t = it.str.trim()
      if (t.length >= 5 && t.length < 40 && /(BÖLÜM|BÖLÜMÜ|TESTİ|TESTI)\s*$/.test(t) &&
          !/BU BÖLÜMDE/.test(t) && !t.includes('/')) {
        return t
      }
    }
  }
  return `Test ${fallbackIndex + 1}`
}

/** Sütun kenarına hizalı sayılabilmesi için işaretçi kümesinin soluna göre tolerans. */
const EDGE_TOL = 12

export function detect(pages: PageText[]): Detection {
  const warnings: string[] = []

  // 1) Sayfa sınıflandırma — önce ÖSYM işaretleri
  const sectionStartPages: number[] = []
  const keyPages: number[] = []
  for (const p of pages) {
    const text = joinPageText(p)
    if (SECTION_MARK_RE.test(text) && /BÖLÜM|TEST/i.test(text)) sectionStartPages.push(p.pageIndex)
  }

  // Yayınevi soru bankası modu: ÖSYM işareti yok ama "KONU Test - N" sayfaları var
  const bankInfos = pages.map((p) => bankTestOf(p))
  const solutionPages = pages.filter((p) => isSolutionsPage(p))
  const bankMode =
    sectionStartPages.length === 0 && bankInfos.some((b) => b && !b.isSolutions)

  let sections: SectionInfo[]
  /** bölüm adı -> ders (konu) adı; bank modunda dolu */
  const bankTopicOf = new Map<string, string>()

  if (bankMode) {
    // Section = Test-başlangıç sayfası + aynı konuyu taşıyan ardışık devam sayfaları
    sections = []
    let cur: { topic: string; testNo: number; sec: SectionInfo } | null = null
    let orphanPages = 0
    for (const p of pages) {
      const info = bankInfos[p.pageIndex]
      if (isSolutionsPage(p)) {
        cur = null
        continue
      }
      if (info) {
        if (cur && cur.topic === info.topic && cur.testNo === info.testNo) {
          cur.sec.lastPage = p.pageIndex
        } else {
          const sec: SectionInfo = {
            name: `${info.topic} · Test ${info.testNo}`,
            firstPage: p.pageIndex,
            lastPage: p.pageIndex,
            questionCount: 0,
          }
          sections.push(sec)
          bankTopicOf.set(sec.name, info.topic)
          cur = { topic: info.topic, testNo: info.testNo, sec }
        }
      } else if (cur && joinPageText(p).includes(cur.topic)) {
        cur.sec.lastPage = p.pageIndex
      } else {
        // test başlığı olmayan sayfa: kapak/ayraç ya da yetim devam sayfası
        if (cur === null && /[A-E]\)/.test(joinPageText(p))) orphanPages++
        cur = null
      }
    }
    if (orphanPages > 0) {
      warnings.push(
        `${orphanPages} sayfa, ait olduğu test başlığı belgede bulunmadığı için atlandı (kitabın tamamı yerine örnek/kısmi PDF yüklenmiş olabilir).`,
      )
    }
  } else {
    if (sectionStartPages.length === 0) {
      // Bölüm başlığı yoksa tüm belgeyi tek bölüm say
      warnings.push('Bölüm başlığı bulunamadı; belge tek bölüm olarak işlendi.')
      sectionStartPages.push(0)
    }
    for (const p of pages) {
      if (p.pageIndex > sectionStartPages[0] && isAnswerKeyPage(p)) keyPages.push(p.pageIndex)
    }
    const firstKeyPage = keyPages.length ? Math.min(...keyPages) : pages.length

    // 2) Test (numara alanı) aralıkları ve adları
    sections = sectionStartPages.map((start, i) => {
      const end = Math.min(
        (sectionStartPages[i + 1] ?? pages.length) - 1,
        firstKeyPage - 1,
      )
      return { name: extractSectionName(pages[start], i), firstPage: start, lastPage: end, questionCount: 0 }
    })
  }
  // Test adlarını benzersizleştir (qid çakışmasın)
  const nameCount = new Map<string, number>()
  for (const s of sections) {
    const n = (nameCount.get(s.name) ?? 0) + 1
    nameCount.set(s.name, n)
    if (n > 1) s.name = `${s.name} (${n})`
  }

  // 3) Bölüm bölüm soru/grup tespiti
  const questions: DetectedQuestion[] = []
  const groups: DetectedGroup[] = []

  for (const section of sections) {
    const bankTopic = bankTopicOf.get(section.name)
    // Bu testin ders aralıkları (kullanıcıya gösterilecek bölünme)
    const secSub = bankTopic
      ? { subAreas: [], singleName: bankTopic }
      : parseSubjects(joinPageText(pages[section.firstPage]))
    const subjectFor = (num: number): string => {
      for (const sa of secSub.subAreas) if (num >= sa.start && num <= sa.end) return sa.name
      return secSub.singleName || section.name
    }
    const layouts = new Map<number, PageLayout>()
    for (let pi = section.firstPage; pi <= section.lastPage; pi++) {
      layouts.set(pi, layoutPage(pages[pi], pi === section.firstPage, bankTopic))
    }

    // Aday toplama: önce grup satırları (içlerindeki "N." öğeleri soru adayı sayılmasın)
    interface Cand extends Boundary {}
    const cands: Cand[] = []
    const usedInGroup = new Set<TextItem>()

    for (let pi = section.firstPage; pi <= section.lastPage; pi++) {
      const layout = layouts.get(pi)!
      for (const col of [0, 1] as const) {
        for (const line of layout.lines[col]) {
          if (line.top < layout.topBound - 2 || line.top > layout.footBound) continue
          const gm = GROUP_RE.exec(line.text)
          if (gm) {
            cands.push({
              kind: 'group', pageIndex: pi, col, top: line.top,
              num: parseInt(gm[1], 10), groupEnd: parseInt(gm[2], 10),
            })
            for (const it of line.items) usedInGroup.add(it)
            continue
          }
          if (END_RE.test(line.text)) {
            cands.push({ kind: 'end', pageIndex: pi, col, top: line.top })
          }
        }
      }
    }

    // Soru numarası adayları: sütun kenar hizası kalibrasyonu için önce x kümesi
    for (const col of [0, 1] as const) {
      const xs: number[] = []
      for (let pi = section.firstPage; pi <= section.lastPage; pi++) {
        const layout = layouts.get(pi)!
        for (const line of layout.lines[col]) {
          for (const it of line.items) {
            if (QNUM_RE.test(it.str.trim()) && !usedInGroup.has(it) &&
                it.top >= layout.topBound - 2 && it.top <= layout.footBound) {
              xs.push(it.x)
            }
          }
        }
      }
      if (!xs.length) continue
      const minX = Math.min(...xs)
      for (let pi = section.firstPage; pi <= section.lastPage; pi++) {
        const layout = layouts.get(pi)!
        for (const line of layout.lines[col]) {
          for (const it of line.items) {
            const m = QNUM_RE.exec(it.str.trim())
            if (!m || usedInGroup.has(it)) continue
            if (it.x > minX + EDGE_TOL) continue
            if (it.top < layout.topBound - 2 || it.top > layout.footBound) continue
            cands.push({
              kind: 'question', pageIndex: pi, col, top: it.top,
              num: parseInt(m[1], 10),
            })
          }
        }
      }
    }

    // Okuma sırası: sayfa -> sütun -> y (aynı noktada grup önce gelsin)
    cands.sort((a, b) =>
      a.pageIndex - b.pageIndex || a.col - b.col || a.top - b.top ||
      (a.kind === 'group' ? -1 : 1) - (b.kind === 'group' ? -1 : 1))

    // Beklenen numara sayacıyla yürüyüş
    interface Entity { kind: 'question' | 'group' | 'end'; boundary: Boundary; q?: DetectedQuestion; g?: DetectedGroup }
    const entities: Entity[] = []
    let expected = 1
    let activeGroup: DetectedGroup | undefined

    for (const c of cands) {
      if (c.kind === 'end') {
        entities.push({ kind: 'end', boundary: c })
        continue
      }
      if (c.kind === 'group') {
        if (c.num === expected && (c.groupEnd ?? 0) >= c.num) {
          const g: DetectedGroup = {
            id: `${section.name}:g${c.num}-${c.groupEnd}`,
            section: section.name, start: c.num!, end: c.groupEnd!, regions: [],
          }
          groups.push(g)
          entities.push({ kind: 'group', boundary: c, g })
          activeGroup = g
        }
        continue
      }
      if (c.num === expected) {
        if (activeGroup && c.num! > activeGroup.end) activeGroup = undefined
        const q: DetectedQuestion = {
          section: section.name, subject: subjectFor(c.num!), number: c.num!, regions: [],
          groupId: activeGroup && c.num! >= activeGroup.start && c.num! <= activeGroup.end
            ? activeGroup.id : undefined,
        }
        questions.push(q)
        entities.push({ kind: 'question', boundary: c, q })
        expected++
      }
    }

    section.questionCount = expected - 1

    // 4) Bölge ataması: her varlık, bir sonraki varlığın çapasına kadar akar
    const colX = (pi: number, col: 0 | 1): [number, number] => {
      const W = pages[pi].width
      const mid = W / 2
      return col === 0 ? [W * 0.055, mid - 2.5] : [mid + 2.5, W - W * 0.04]
    }

    for (let i = 0; i < entities.length; i++) {
      const e = entities[i]
      if (e.kind === 'end') continue
      const next = entities[i + 1]
      const startB = e.boundary
      const regions: Region[] = []
      // akış: başlangıç sütunundan bitiş çapasına kadar sütunları sırayla dolaş
      let pi = startB.pageIndex
      let col = startB.col
      let y = Math.max(startB.top - 5, layouts.get(pi)!.topBound)
      let steps = 0
      while (steps++ < 6) {
        const layout = layouts.get(pi)
        if (!layout) break
        const [x0, x1] = colX(pi, col)
        const isEndCol = next && next.boundary.pageIndex === pi && next.boundary.col === col
        const yEnd = isEndCol ? next.boundary.top - 5 : layout.footBound
        if (yEnd > y + 4) {
          // bölgede gerçekten içerik var mı? (boş sütun/sayfa atlanır)
          const hasContent = layout.lines[col].some(
            (l) => l.top >= y - 1 && l.top < yEnd && l.text.trim().length > 0,
          )
          if (hasContent || steps === 1) {
            regions.push({ pageIndex: pi, x0, y0: y, x1, y1: yEnd })
          }
        }
        if (isEndCol || !next) break
        // sonraki sütuna geç
        if (col === 0) { col = 1 } else { col = 0; pi++ }
        if (pi > section.lastPage) break
        y = layouts.get(pi)?.topBound ?? 0
      }
      if (e.q) e.q.regions = regions
      if (e.g) e.g.regions = regions
    }
  }

  // 5) Cevap anahtarı: ÖSYM'de anahtar sayfası, soru bankasında ÇÖZÜMLER sayfaları
  const answerKey = bankMode
    ? parseBankAnswers(
        solutionPages.map((p) => ({ page: p, info: bankInfos[p.pageIndex] })),
        warnings,
      )
    : parseAnswerKey(keyPages.map((pi) => pages[pi]), sections.map((s) => s.name), warnings)

  // 6) Dersler (kullanıcıya gösterilen bölünme): görülme sırasını koru, adı
  //    tekrar edenleri (ör. SB2'de iki "Felsefe Grubu") birleştir.
  const subjects: SubjectInfo[] = []
  const subjIndex = new Map<string, SubjectInfo>()
  for (const q of questions) {
    let s = subjIndex.get(q.subject)
    if (!s) {
      s = { name: q.subject, questionCount: 0, hasAnswerKey: false }
      subjIndex.set(q.subject, s)
      subjects.push(s)
    }
    s.questionCount++
    if (answerKey[q.section]?.[q.number] != null) s.hasAnswerKey = true
  }

  for (const s of sections) {
    if (s.questionCount === 0) warnings.push(`"${s.name}" bölümünde soru bulunamadı.`)
  }

  return { sections, subjects, questions, groups, answerKey, warnings }
}
