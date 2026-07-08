import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from 'pdf-lib'

// ÖSYM kitapçıklarındaki filigran (örn. 45° döndürülmüş, %25 opak dev "ÖSYM")
// render edilmeden önce içerik akışından çıkarılır. Piksel silme yerine kaynak
// düzeyinde temizlik: soru içeriğindeki meşru gri tonlara dokunulmaz ve filigran,
// metinle çakıştığı yerlerde bile tamamen yok olur.
//
// Kurallar (bir blok filigran sayılır):
//  1. KESİN — /Artifact <</Subtype /Watermark …>> BDC … EMC işaretli içerik
//     (ÖSYM PDF'lerinde filigran bu standart sarmalayıcıyla geliyor).
//  2. SEZGİSEL — BT…ET bloğunda döndürülmüş metin (Tm'nin b/c bileşeni belirgin)
//     ve etkin punto ≥ 20, veya etkin punto ≥ 60 (içerik ~14pt'yi geçmez).
//  3. SEZGİSEL — q…Q kapsamında döndürülmüş + ölçekli (≥2) cm ardından saydamlık
//     (gs) ve XObject çizimi (Do): döndürülmüş yarı saydam damga.

export interface WatermarkResult {
  bytes: Uint8Array
  removedBlocks: number
}

export async function removeWatermarks(input: Uint8Array): Promise<WatermarkResult> {
  try {
    const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false })
    let removed = 0

    // Sayfa içerik akışları
    for (const page of doc.getPages()) {
      try {
        const content = readPageContent(page)
        if (!content) continue
        const { cleaned, count } = stripWatermarkBlocks(content)
        if (count > 0) {
          removed += count
          const stream = doc.context.stream(latin1Bytes(cleaned))
          page.node.set(PDFName.of('Contents'), doc.context.register(stream))
        }
      } catch {
        // sayfa işlenemezse olduğu gibi bırak
      }
    }

    // Form XObject akışları (filigran metni bir XObject'in içinde de olabilir)
    for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue
      try {
        const subtype = obj.dict.get(PDFName.of('Subtype'))
        if (subtype !== PDFName.of('Form')) continue
        const content = latin1String(decodePDFRawStream(obj).decode())
        const { cleaned, count } = stripWatermarkBlocks(content)
        if (count > 0) {
          removed += count
          const bytes = latin1Bytes(cleaned)
          const dict = obj.dict.clone(doc.context)
          dict.delete(PDFName.of('Filter'))
          dict.delete(PDFName.of('DecodeParms'))
          dict.set(PDFName.of('Length'), doc.context.obj(bytes.length))
          doc.context.assign(ref, PDFRawStream.of(dict as PDFDict, bytes))
        }
      } catch {
        // bu XObject'i olduğu gibi bırak
      }
    }

    if (removed === 0) return { bytes: input, removedBlocks: 0 }
    const out = await doc.save({ useObjectStreams: false })
    return { bytes: out, removedBlocks: removed }
  } catch {
    return { bytes: input, removedBlocks: 0 }
  }
}

function readPageContent(page: { node: { Contents(): unknown } }): string | null {
  const contents = page.node.Contents()
  if (!contents) return null
  const streams: PDFRawStream[] = []
  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) {
      const obj = contents.lookup(i)
      if (obj instanceof PDFRawStream) streams.push(obj)
    }
  } else if (contents instanceof PDFRawStream) {
    streams.push(contents)
  }
  if (!streams.length) return null
  return streams.map((s) => latin1String(decodePDFRawStream(s).decode())).join('\n')
}

function latin1String(bytes: Uint8Array): string {
  let s = ''
  const CHUNK = 8192
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return s
}

function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}

const WS = new Set([' ', '\t', '\r', '\n', '\f', '\0'])
const DELIM = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%'])

/**
 * İçerik akışını PDF sözdizimine saygılı biçimde tarar (string/hex literalleri,
 * sözlükler ve inline görüntüler doğru atlanır), filigran bloklarını boşlukla
 * değiştirir.
 */
export function stripWatermarkBlocks(src: string): { cleaned: string; count: number } {
  const n = src.length
  const ranges: Array<[number, number]> = []
  let i = 0

  // BT…ET durumu
  let btStart = -1
  let tfSize = 0 // grafik durumunun parçası; bloklar arasında korunur
  let tm: number[] | null = null
  let btSuspicious = false

  // /Artifact /Watermark BDC…EMC durumu
  let pendingName: string | null = null
  let pendingNameStart = -1
  let pendingDict: string | null = null
  let mcStart = -1 // aktif filigran marked-content bloğunun başlangıcı
  let mcDepth = 0

  // q…Q (döndürülmüş cm + gs + Do) durumu
  const qStack: Array<{ start: number; rotCm: boolean; gs: boolean; remove: boolean }> = []

  let nums: number[] = []

  const skipLiteralString = () => {
    let depth = 0
    while (i < n) {
      const c = src[i]
      if (c === '\\') i += 2
      else if (c === '(') {
        depth++
        i++
      } else if (c === ')') {
        depth--
        i++
        if (depth === 0) return
      } else i++
    }
  }

  const skipHexString = () => {
    while (i < n && src[i] !== '>') i++
    i++
  }

  const readDict = (): string => {
    // '<<' konumundayız
    const start = i
    let depth = 0
    while (i < n) {
      const c = src[i]
      if (c === '<' && src[i + 1] === '<') {
        depth++
        i += 2
      } else if (c === '>' && src[i + 1] === '>') {
        depth--
        i += 2
        if (depth === 0) break
      } else if (c === '(') {
        skipLiteralString()
      } else if (c === '<') {
        skipHexString()
      } else i++
    }
    return src.slice(start, i)
  }

  const skipInlineImage = () => {
    while (i < n - 1) {
      if (
        src[i] === 'E' &&
        src[i + 1] === 'I' &&
        (i + 2 >= n || WS.has(src[i + 2]) || DELIM.has(src[i + 2])) &&
        WS.has(src[i - 1])
      ) {
        i += 2
        return
      }
      i++
    }
    i = n
  }

  const isRotated = (m: number[] | null): boolean =>
    m !== null &&
    (Math.abs(m[1]) > 0.1 * Math.max(Math.abs(m[0]), 0.01) ||
      Math.abs(m[2]) > 0.1 * Math.max(Math.abs(m[3]), 0.01))

  const evalShowOp = () => {
    const scale = tm ? Math.hypot(tm[0], tm[1]) : 1
    const eff = tfSize * (scale || 1)
    // Döndürülmüş metin ≥14pt (ör. 45° "ÖSYM" ve "Bu soruların telif hakları…"
    // filigran satırı 16pt) ya da herhangi bir ≥60pt dev metin → filigran.
    if ((isRotated(tm) && eff >= 14) || eff >= 60) btSuspicious = true
  }

  while (i < n) {
    const ch = src[i]
    if (WS.has(ch)) {
      i++
      continue
    }
    if (ch === '%') {
      while (i < n && src[i] !== '\n' && src[i] !== '\r') i++
      continue
    }
    if (ch === '(') {
      skipLiteralString()
      continue
    }
    if (ch === '<') {
      if (src[i + 1] === '<') {
        pendingDict = readDict()
      } else {
        skipHexString()
      }
      nums = []
      continue
    }
    if (ch === '>') {
      i += src[i + 1] === '>' ? 2 : 1
      continue
    }
    if (ch === '[' || ch === ']' || ch === '{' || ch === '}') {
      i++
      continue
    }
    if (ch === '/') {
      const start = i
      i++
      while (i < n && !WS.has(src[i]) && !DELIM.has(src[i])) i++
      pendingName = src.slice(start, i)
      pendingNameStart = start
      pendingDict = null
      nums = []
      continue
    }

    const start = i
    while (i < n && !WS.has(src[i]) && !DELIM.has(src[i])) i++
    const tok = src.slice(start, i)

    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) {
      nums.push(parseFloat(tok))
      if (nums.length > 8) nums.shift()
      continue
    }

    switch (tok) {
      case 'BI':
        skipInlineImage()
        break

      // --- marked content: /Artifact <</Subtype /Watermark>> BDC … EMC ---
      case 'BDC':
      case 'BMC':
        if (mcStart >= 0) {
          mcDepth++
        } else if (
          tok === 'BDC' &&
          pendingName === '/Artifact' &&
          pendingDict !== null &&
          pendingDict.includes('/Watermark')
        ) {
          mcStart = pendingNameStart
          mcDepth = 1
        }
        break
      case 'EMC':
        if (mcStart >= 0) {
          mcDepth--
          if (mcDepth === 0) {
            ranges.push([mcStart, i])
            mcStart = -1
          }
        }
        break

      // --- BT…ET sezgiseli ---
      case 'BT':
        btStart = start
        tm = null
        btSuspicious = false
        break
      case 'Tf':
        if (nums.length) tfSize = Math.abs(nums[nums.length - 1])
        break
      case 'Tm':
        if (nums.length >= 6) tm = nums.slice(-6)
        break
      case 'Tj':
      case 'TJ':
      case "'":
      case '"':
        if (btStart >= 0) evalShowOp()
        break
      case 'ET':
        if (btStart >= 0 && btSuspicious) ranges.push([btStart, i])
        btStart = -1
        break

      // --- q…Q içinde döndürülmüş cm + gs + Do sezgiseli ---
      case 'q':
        qStack.push({ start, rotCm: false, gs: false, remove: false })
        break
      case 'cm':
        if (nums.length >= 6 && qStack.length) {
          const m = nums.slice(-6)
          // Döndürülmüş XObject çizimi (ör. 45° filigran sarmalayıcısı) =
          // filigran. Soru içeriği/figürleri döndürülmüş Do ile çizilmez.
          if (isRotated(m)) qStack[qStack.length - 1].rotCm = true
        }
        break
      case 'gs':
        if (qStack.length) qStack[qStack.length - 1].gs = true
        break
      case 'Do': {
        const top = qStack[qStack.length - 1]
        if (top && top.rotCm) top.remove = true
        break
      }
      case 'Q': {
        const entry = qStack.pop()
        if (entry?.remove) ranges.push([entry.start, i])
        break
      }
    }
    pendingName = null
    pendingDict = null
    nums = []
  }

  if (!ranges.length) return { cleaned: src, count: 0 }
  const chars = src.split('')
  for (const [s, e] of ranges) {
    for (let k = s; k < e; k++) chars[k] = ' '
  }
  return { cleaned: chars.join(''), count: ranges.length }
}
