<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/cdc8be20-a31a-4fd7-8ee2-b960a43e63a4

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Pro (Freemium) Yapılandırması

- `PRO_KEYS`: Sunucu ortam değişkeni; virgülle ayrılmış geçerli lisans anahtarları
  (örn. `PRO_KEYS=WF3D-AB12-CD34,WF3D-EF56-GH78`). Render → Environment'tan ayarlanır.
  Anahtarları Gumroad/Lemon Squeezy gibi bir platformda satıp müşteriye iletebilirsiniz.
- `VITE_PAYMENT_URL`: Build sırasında gömülen satın alma sayfası bağlantısı
  (Stripe Payment Link, Gumroad ürün sayfası vb.). Ayarlanmazsa modalda
  "yakında" notu gösterilir.
- STL / DXF / PDF exportları Pro lisans gerektirir; lisans anahtarı uygulama
  içindeki "PRO'YA GEÇ" modalından aktive edilir (tarayıcıda saklanır).

## Ziyaretçi Sayacı

- `STATS_DIR`: Sayaç verisinin yazılacağı klasör (varsayılan `./data`).
  Render'da kalıcı olması için Persistent Disk ekleyip bu değişkeni disk
  yoluna ayarlayın; aksi halde sayaç her deploy'da sıfırlanır.
