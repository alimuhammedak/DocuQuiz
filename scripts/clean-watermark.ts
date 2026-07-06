// Filigran temizliğini tarayıcısız denemek için:
//   npx tsx scripts/clean-watermark.ts <girdi.pdf> <cikti.pdf>
import { readFile, writeFile } from 'node:fs/promises'
import { removeWatermarks } from '../src/parser/removeWatermark'

const [inPath, outPath] = process.argv.slice(2)
if (!inPath || !outPath) {
  console.error('kullanım: npx tsx scripts/clean-watermark.ts <girdi.pdf> <cikti.pdf>')
  process.exit(1)
}
const input = new Uint8Array(await readFile(inPath))
const { bytes, removedBlocks } = await removeWatermarks(input)
await writeFile(outPath, bytes)
console.log(`temizlenen blok: ${removedBlocks}  →  ${outPath}`)
