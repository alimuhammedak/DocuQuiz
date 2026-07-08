// Tespit mantığını tarayıcı olmadan sınamak için analiz betiği:
//   npx tsx scripts/analyze.ts <pdf-yolu>
import { readFile } from 'node:fs/promises'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { extractPageTexts } from '../src/parser/extract'
import { detect } from '../src/parser/detect'
import { removeWatermarks } from '../src/parser/removeWatermark'

const path = process.argv[2]
if (!path) {
  console.error('kullanım: npx tsx scripts/analyze.ts <pdf>')
  process.exit(1)
}

const raw = new Uint8Array(await readFile(path))
const { bytes, removedBlocks } = await removeWatermarks(raw)
if (removedBlocks) console.log(`filigran: ${removedBlocks} blok temizlendi`)
const doc = await getDocument({ data: bytes }).promise
const pages = await extractPageTexts(doc)
const det = detect(pages)

console.log('--- TESTLER (numara alanı) ---')
for (const s of det.sections) {
  console.log(`  "${s.name}"  sayfa ${s.firstPage + 1}-${s.lastPage + 1}  soru: ${s.questionCount}`)
}
console.log('--- DERSLER (kullanıcı bölünmesi) ---')
for (const s of det.subjects) {
  console.log(`  "${s.name}"  ${s.questionCount} soru  ${s.hasAnswerKey ? 'anahtar ✓' : 'anahtar yok'}`)
}
console.log('--- GRUPLAR ---')
for (const g of det.groups) {
  console.log(`  ${g.section}: ${g.start}-${g.end}  bölge: ${g.regions.map((r) => `p${r.pageIndex + 1}[${r.y0.toFixed(0)}..${r.y1.toFixed(0)}]`).join(' + ')}`)
}
console.log('--- SORULAR (bölge özetli, ilk/son 5 + çok bölgeliler) ---')
const qs = det.questions
const show = (i: number) => {
  const q = qs[i]
  console.log(
    `  ${q.section} #${q.number}  ${q.regions.map((r) => `p${r.pageIndex + 1}c${r.x0 < pages[r.pageIndex].width / 2 ? 'L' : 'R'}[${r.y0.toFixed(0)}..${r.y1.toFixed(0)}]`).join(' + ')}${q.groupId ? '  grup:' + q.groupId : ''}`,
  )
}
for (let i = 0; i < qs.length; i++) {
  if (i < 5 || i >= qs.length - 5 || qs[i].regions.length > 1) show(i)
}
console.log('--- CEVAP ANAHTARI ---')
for (const [sec, key] of Object.entries(det.answerKey)) {
  const nums = Object.keys(key).map(Number).sort((a, b) => a - b)
  console.log(`  ${sec}: ${nums.length} cevap  ilk5: ${nums.slice(0, 5).map((n) => `${n}=${key[n]}`).join(' ')}  son3: ${nums.slice(-3).map((n) => `${n}=${key[n]}`).join(' ')}`)
}
console.log('--- UYARILAR ---')
for (const w of det.warnings) console.log('  !', w)
console.log(`TOPLAM SORU: ${qs.length}`)

// İsteğe bağlı: bölgeleri JSON olarak dök (görsel doğrulama için)
if (process.env.DUMP_REGIONS) {
  const { writeFile } = await import('node:fs/promises')
  await writeFile(
    process.env.DUMP_REGIONS,
    JSON.stringify({ questions: det.questions, groups: det.groups }, null, 1),
  )
  console.log('bölgeler yazıldı:', process.env.DUMP_REGIONS)
}
