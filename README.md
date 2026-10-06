# 💿 Yenisahra Underground

Gerçek bir mahallenin gerçek sokaklarında gezip **simit, çay, lokum, İstanbulkart, nazar boncuğu, altın** topladığın,
**sokak kedilerini beslediğin** ve çıkmaz sokaklara saklanmış **7 kayıp "Underground" plağının** peşine düştüğün,
tarayıcıda çalışan bir keşif oyunu. Varsayılan mahalle: **Yenisahra, Ataşehir (İstanbul)**.

İki görünüm var:

| Mod | Ne gerekir | Nasıl görünür |
| --- | --- | --- |
| 🏙️ **3D Mahalle** (varsayılan) | Hiçbir şey | Gerçek sokak, bina, park ve dükkân verisinden üretilen stilize 3D şehir. Gece pencereler yanar. |
| 📷 **Google Street View** | Google Maps JavaScript API anahtarı | Gerçek sokak fotoğrafları; eşyalar, kediler ve görev hedefleri panoramanın üstüne çizilir. |

## Oynamak

```bash
npm install
npm run dev        # http://localhost:5173
```

Menüde semt adını yaz ya da hazır haritalardan birini seç, görünümü seç, **Oyna**.

Hazır gelen (internetsiz, anında açılan) haritalar: **Yenisahra** (Ataşehir), **Sahrayıcedit**, **Kozyatağı**,
**Moda (Caferağa)** (Kadıköy), **Kuzguncuk** (Üsküdar), **Cihangir** (Beyoğlu).

### Kontroller

| Tuş | İş |
| --- | --- |
| `W` `↑` / `S` `↓` | ileri / geri (Street View'da bir sonraki panoramaya geçer) |
| `A` `D` / `←` `→` | dön |
| `Shift` | koş |
| `M` | büyük harita (sürükle, tekerlekle yakınlaştır) |
| `K` / `Tab` | albüm: eşyalar, kediler, plaklar, rozetler, mekânlar, istatistik |
| `V` | kamera: takip → birinci şahıs → kuşbakışı |
| `N` | ses aç/kapat |
| `Esc` / `P` | durdur menüsü (gün döngüsü ayarı, ana menü, sıfırlama) |

Dokunmatik ekranlarda sol altta sanal joystick ve 🏃 koşma düğmesi çıkar.

## Oyun mekaniği

- **Başlangıç bölgesi — Atalay Caddesi:** Yenisahra'da yeni oyun Atalay Caddesi'nde başlar. İlk bölüm, Atalay'ı ve onu
  kesen cadde/sokakların Atalay'a yakın (150 m) kısımlarını yürümektir: Fatih Caddesi, Sütçü Yolu Caddesi, Alaca, Erdaş,
  Figen, Gamlı, Melda ve Özcanlar sokakları. Bölge haritada altın rengiyle işaretlidir; HUD'da "Atalay bölgesi x/9 sokak"
  yazar (tıklayınca sıradaki sokağa yol tarifi açılır). Bölüm açıkken görevlerden biri hep bu sokaklardan gelir, bölgede
  daha çok eşya çıkar, iki kedi orada yaşar ve plaklardan biri Atalay'ın yakınında saklıdır. Bölüm bitince +500 puan ve
  "Atalay'ın Müdavimi" rozeti; oyun tüm Yenisahra'da serbest dolaşmayla sürer.
- **Sokak dokusu:** kavşaklarda İstanbul'un mavi sokak tabelaları (ör. "ATALAY CD." / "YENİSAHRA MAH."), sokak kenarında
  park etmiş arabalar, dükkânların önünde tenteler.

- **Eşyalar** sokaklara yayılır ve sen topladıkça uzak yerlerde yeniden belirir. Gerçek mekânlara göre dağılırlar:
  fırınların çevresinde simit, kafelerin önünde çay, durakların yakınında İstanbulkart, marketlerin önünde lokum ve kedi maması.
- **Kombo:** 4,5 saniye içinde art arda toplanan her eşya çarpanı artırır (x2 → x5).
- **Günün eşyası:** her gün farklı bir eşya iki kat puan verir.
- **Keşif:** sokaklar 10 metrelik parçalara bölünmüştür; her yeni parça puan verir, haritada parlar.
  Bir sokağın tamamını yürüyünce (%90) "sokak tamamlandı" bonusu alırsın. Üstteki etikette bulunduğun sokağın yüzdesi yazar.
- **Mekânlar:** haritadaki gerçek dükkân, kafe, fırın, okul ve camilerin yanından geçince keşfedilir ve albüme eklenir.
  Metro istasyonuna ulaşmak ayrı bir ödül ("Yeraltına İniş").
- **Sokak kedileri:** mahallede 10 isimli kedi dolaşır (Tekir, Pamuk, Duman, Zeytin…). 🐟 kedi maması toplayıp
  (en fazla 5) yanlarına gidince beslersin; doyan kedi bir süre peşinden gelir, birkaç dakika sonra yine acıkır.
- **Underground plakları:** 7 plak çıkmaz sokakların sonunda saklıdır ve haritada görünmez. Bulduğun plakları
  albümde **çalabilirsin** (her biri prosedürel üretilmiş farklı bir parça).
- **Güçlendirmeler:** 🧲 mıknatıs (eşyaları çeker), 🛴 scooter (hız), 🧭 pusula (en yakın plağı gösterir).
- **Yol tarifi:** takip edilen görevin hedefine giden en kısa yol mini haritada kesikli çizgi, 3D'de yerde akan
  ışıklı iz olarak görünür. Görev paneline tıklayarak hangi görevi takip edeceğini seçersin.
- **Görevler:** her an 3 aktif görev vardır (eşya topla, sokağı baştan sona yürü, mekâna uğra, kedi besle, kombo yap,
  mahallenin %X'ini keşfet). Hedefler 3D'de renkli ışık sütunu, haritada elmas olarak görünür.
- **Seviyeler ve rozetler:** Yabancı → Misafir → Komşu → Mahalleli → Esnaf → Muhtar → Mahalle Efsanesi → Semt Kahramanı → Underground Efsanesi; 25 rozet.
- İlerleme her mahalle için ayrı olarak tarayıcıya (localStorage) kaydedilir.

## Başka bir semt

Menüye başka bir semt yaz (ör. `Moda, Kadıköy`): oyun konumu **Nominatim** ile bulur, sokak/bina/mekân verisini
**Overpass API** üzerinden OpenStreetMap'ten indirir (internet gerekir; büyük yerler merkezde 1 km yarıçapla sınırlanır).
İndirilen harita 30 gün tarayıcıda önbelleklenir.

Hazır gelen (anında açılan) haritalar `public/data/` altında. Yenisini eklemek için:

```bash
pip install pyarrow shapely
python3 tools/extract_overture.py --name Kozyatağı --slug kozyatagi --full "Kozyatağı, Kadıköy, İstanbul"
```

ve `src/data/areas.ts` içindeki `BUNDLED` listesine ekle. Betik veriyi **Overture Maps** (OSM tabanlı) açık veri
setinden S3 üzerinden okur.

## Google Street View anahtarı

1. [Google Cloud Console](https://console.cloud.google.com/)'da bir proje aç, faturalandırmayı etkinleştir
   (Street View'ın aylık ücretsiz kullanım kotası vardır).
2. **Maps JavaScript API**'yi etkinleştir, **Credentials → Create credentials → API key**.
3. Anahtarı **HTTP referrer** ile kendi alan adına (ör. `https://kullanici.github.io/*`, `http://localhost:5173/*`) kısıtla.
4. Oyunda "Google Street View" modunu seçip anahtarı yapıştır. Anahtar yalnızca senin tarayıcında saklanır,
   repoya girmez. Anahtar reddedilirse oyun otomatik olarak 3D moda geçer.

## Geliştirme

```bash
npm test           # birim testleri (vitest): sokak ağı, hareket, eşyalar, görevler, kayıt, OSM dönüştürücü
npm run e2e        # uçtan uca testler (Playwright, Chromium): menü, yürüme, toplama, kayıt, harita,
                   # Street View (sahte Google API ile), OSM yükleme (sahte yanıtlarla), mobil joystick
npm run typecheck
npm run build      # dist/ — statik site, herhangi bir yerde barındırılabilir
npm run build:artifact   # dist-artifact/game.html — tek sayfalık sürüm (claude.ai Artifact olarak yayınlamak için)
```

`tests/playtest.test.ts` oyunu 10 dakika boyunca otomatik oynayan bir bot çalıştırır (rota bulma ile eşya ve
görev hedeflerine gider); puan akışının sürdüğünü, görevlerin tamamlanabildiğini ve oyuncunun hiçbir yerde
takılmadığını kontrol eder.

Kod yapısı:

```
src/core/      oyun mantığı (DOM'suz, test edilebilir)
  streets.ts   sokak grafiği, yürünebilir koridorlar, keşif örnekleri
  game.ts      oyuncu, eşyalar, kediler, kombo, güçlendirmeler, puan
  quests.ts    görev üretimi ve takibi
  badges.ts    rozetler
  progress.ts  kayıt / yükleme
src/render/    world3d.ts (Three.js), city.ts (bina/yol geometrisi), models.ts, minimap.ts, streetview.ts
src/ui/        hud.ts, input.ts (klavye + joystick), audio.ts (WebAudio efektleri ve plak müziği)
src/data/      hazır haritalar ve OSM yükleyici
tools/         Overture Maps'ten harita üretme betiği
```

`main` dalına push edildiğinde `.github/workflows/pages.yml` oyunu GitHub Pages'e yayınlar
(repo ayarlarında **Settings → Pages → Source: GitHub Actions** seçili olmalı).

## Lisans ve atıf

Harita verisi © [OpenStreetMap](https://www.openstreetmap.org/copyright) katkıcıları (ODbL), [Overture Maps Foundation](https://overturemaps.org).
Street View görüntüleri © Google.
