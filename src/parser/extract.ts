import type { PageText, TextItem } from './types'

// pdf.js belgesinden koordinatlı metin çıkarır. Hem tarayıcıda hem Node
// analiz betiğinde kullanılır; bu yüzden pdfjs'e tip bağımlılığı yok.
export async function extractPageTexts(
  doc: {
    numPages: number
    getPage(n: number): Promise<{
      getViewport(o: { scale: number }): {
        width: number
        height: number
        convertToViewportPoint(x: number, y: number): number[]
      }
      getTextContent(): Promise<{ items: unknown[] }>
    }>
  },
  onProgress?: (done: number, total: number) => void,
): Promise<PageText[]> {
  const pages: PageText[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const vp = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const items: TextItem[] = []
    for (const raw of content.items) {
      const it = raw as { str?: string; transform?: number[]; width?: number; height?: number }
      if (typeof it.str !== 'string' || !it.str.trim() || !it.transform) continue
      const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5])
      const h = it.height || Math.abs(it.transform[3]) || 10
      items.push({
        str: it.str,
        x,
        top: y - h,
        bottom: y + h * 0.3,
        w: it.width ?? 0,
        h,
      })
    }
    pages.push({ pageIndex: i - 1, width: vp.width, height: vp.height, items })
    onProgress?.(i, doc.numPages)
  }
  return pages
}
