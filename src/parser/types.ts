// Ayrıştırıcının ortak tipleri. detect.ts saf fonksiyonlardan oluşur ki
// hem tarayıcıda (parsePdf.ts) hem Node analiz betiğinde (scripts/analyze.ts)
// aynı mantık çalışabilsin.

export interface TextItem {
  str: string
  /** sol kenar, PDF birimi */
  x: number
  /** üst kenar, sol-üst orijinli PDF birimi */
  top: number
  bottom: number
  w: number
  h: number
}

export interface PageText {
  pageIndex: number
  width: number
  height: number
  items: TextItem[]
}

export interface Region {
  pageIndex: number
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface DetectedGroup {
  id: string
  section: string
  start: number
  end: number
  regions: Region[]
}

export interface DetectedQuestion {
  section: string
  number: number
  regions: Region[]
  groupId?: string
}

export interface SectionInfo {
  name: string
  firstPage: number
  lastPage: number
  questionCount: number
}

export interface Detection {
  sections: SectionInfo[]
  questions: DetectedQuestion[]
  groups: DetectedGroup[]
  /** bölüm adı -> soru no -> doğru şık */
  answerKey: Record<string, Record<number, string>>
  warnings: string[]
}
