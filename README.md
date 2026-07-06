# DocuQuiz 📝

ÖSYM sınav PDF'lerini soru soru çözülebilen interaktif bir sınava dönüştüren web uygulaması.
PDF'i yüklersin; sorular otomatik ayrıştırılır ve **gerçek sınav kuralıyla** karşına gelir:
şıkka tıkladığın an cevap kilitlenir, sonraki soruya geçilir — **geri dönüş ve cevap değiştirme yoktur**.

## Özellikler

- **PDF'ten otomatik soru ayrıştırma** — iki sütunlu ÖSYM kitapçık düzeni tanınır; sorular
  şekil, tablo ve matematik ifadeleri birebir korunarak **görüntü olarak** kırpılır.
- **Ortak paragraf/bilgi grupları** — "41.-42. soruları aşağıdaki parçaya göre cevaplayınız."
  gibi bloklar, gruptaki her soruyla birlikte gösterilir.
- **Cevap anahtarı** — kitapçığın sonundaki anahtar otomatik okunur; sınav sonunda
  doğru / yanlış / boş ve **net** (4 yanlış = 1 doğru götürür) hesaplanır.
- **Süre** — sağ panelde kronometre veya geri sayım (süre bitince sınav otomatik biter).
- **Boş bırakma** — soruyu atlayabilirsin ama geri dönemezsin.
- **Yerel veritabanı** — her şey tarayıcının IndexedDB'sinde saklanır; sunucu yok,
  internet gerekmez, PDF bir kez ayrıştırılır. Yarım kalan sınava kaldığın yerden devam edebilirsin.
- **İnceleme ekranı** — sınav bitince her sorunun görselini, kendi cevabını ve doğru cevabı görürsün.
- Klavye kısayolları: `A`–`E` veya `1`–`5` şık seçer, `B` boş bırakır.

## Kurulum

```bash
npm install
npm run dev
```

Tarayıcıda `http://localhost:5173` adresini aç.

Üretim derlemesi için:

```bash
npm run build   # çıktı: dist/ (statik dosyalar, herhangi bir sunucuda barındırılabilir)
```

## Kullanım

1. Ana sayfadaki alana ÖSYM PDF'ini sürükle (veya tıklayıp seç).
2. Ayrıştırma bitince bölümü seç (örn. SAYISAL / SÖZEL), süre modunu belirle, sınavı başlat.
3. Soruları çöz: şıkka tıkla → kilitlenir → sonraki soru. İstersen "Boş Bırak".
4. Sınav bitince sonucu ve soru soru incelemeyi gör.

## Nasıl çalışıyor?

- [pdf.js](https://mozilla.github.io/pdf.js/) ile sayfa metni koordinatlarıyla çıkarılır;
  sütun kenarına hizalı `1.` `2.` … işaretçileri ve ardışık numara doğrulaması ile soru
  sınırları bulunur (`src/parser/detect.ts`).
- Sayfalar canvas'a yüksek çözünürlükte çizilir, her soru kendi bölgesinden kırpılıp
  PNG olarak IndexedDB'ye ([Dexie](https://dexie.org/)) kaydedilir (`src/parser/parsePdf.ts`).
- Cevap anahtarı sayfası "N. X" çiftlerinden okunur; numaranın 1'e sıfırlanması yeni
  bölüm demektir (`src/parser/answerKey.ts`).

Ayrıştırmayı tarayıcı olmadan denemek için:

```bash
npx tsx scripts/analyze.ts /yol/kitapcik.pdf
```

## Notlar

- Metin katmanı olmayan (taranmış görüntü) PDF'ler desteklenmez.
- Veriler tarayıcıya bağlıdır: farklı tarayıcı/profil veya site verilerini temizlemek
  sınavları siler.
