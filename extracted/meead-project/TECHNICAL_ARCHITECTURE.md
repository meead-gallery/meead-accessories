# گزارش فنی معماری — MEEAD ACCESSORIES Web App
تاریخ گزارش: بر اساس آخرین نسخه‌ی ساخته‌شده در این گفتگو (فایل `meead-app.jsx`)

---

## ۱) خلاصه‌ی وضعیت فعلی

پروژه فعلاً **یک فایل React تکی** (`meead-app.jsx`, حدود ۱۴۷۰ خط) است که در محیط Artifact اجرا می‌شود. هیچ Backend، Database یا سروری وجود ندارد. تمام داده‌ها در یک فضای ذخیره‌سازی کلید-مقدار مخصوص Artifact (`window.storage`) نگهداری می‌شوند.

نکته‌ی مهم معماری: **هیچ کامپوننت UI مستقیماً به `window.storage` دسترسی ندارد.** تمام منطق تجاری و تمام دسترسی به داده از یک لایه‌ی سرویس به اسم `api` عبور می‌کند. این یعنی کد از روز اول برای جایگزینی storage با یک Backend واقعی طراحی شده، بدون نیاز به بازنویسی UI.

```
UI Components  →  api.*()  →  store.read/write()  →  window.storage
   (~۲۰ کامپوننت)   (لایه‌ی سرویس)   (تنها نقطه‌ی تماس با storage)
```

---

## ۲) نقشه‌ی فایل — همه‌چیز در یک فایل است

چون پروژه هنوز یک Artifact تک‌فایلی است، تفکیک «فایل‌ها» در واقع تفکیک **بخش‌های داخل همان فایل** است. این نقشه دقیقاً کجا چه چیزی است:

| بخش | خط تقریبی | شرح |
|---|---|---|
| Config پایه (`PRODUCTS`, `DEFAULT_SETTINGS`, `BUY_STATUSES`, `SELL_STATUSES`) | ۱۱–۳۳ | تعریف محصولات، تنظیمات پیش‌فرض، لیست وضعیت‌های سفارش |
| Helper‌های خالص (`isWithinClosedWindow`, `genOrderCode`, `fileToBase64`, `toman`, `fmtTime`...) | ۳۵–۸۳ | توابع بدون وابستگی به storage یا React |
| **`store`** — تنها نقطه‌ی تماس با storage | ۸۵–۱۰۲ | `store.read(key)` / `store.write(key, value)` |
| **`api`** — لایه‌ی سرویس / منطق تجاری | ۱۱۵–۳۳۴ | تمام قوانین کسب‌وکار اینجاست (بخش ۳ را ببینید) |
| کامپوننت‌های آیکون/UI کوچک | ۳۳۸–۳۵۶ | `TrendArrow`, `GoldMark` |
| **`App`** — کامپوننت اصلی و مدیریت state | ۳۵۷–۵۴۸ | نگهداری state در React، فراخوانی `api`، routing بین صفحات |
| صفحات مشتری | ۵۴۹–۸۸۴ | `Home`, `PriceHalf`, `TrackOrder`, `OrderForm`, `OrderSummary`, `BuyPayment`, `SellSubmitted` |
| پنل مدیریت | ۸۸۵–۱۳۱۴ | `AdminLogin`, `Admin`, و تب‌ها: `TabDashboard`, `TabPrices`, `OrderRow`, `TabOrders`, `TabCustomers`, `TabMarket`, `TabSettings`, `TabLog`, `TabBackup` |
| استایل‌ها (`GlobalStyles`) | ۱۳۱۵ تا انتها | تمام CSS به‌صورت یک `<style>` تگ |

اگر بخواهیم این را به یک پروژه‌ی چندفایلی واقعی تبدیل کنیم، مرز طبیعی تفکیک همین بخش‌بندی بالاست (مثلاً `services/api.js`, `pages/Home.jsx`, `admin/*.jsx`, `styles.css`).

---

## ۳) `api` چگونه کار می‌کند

`api` یک آبجکت با متدهای `async` است. هر متد دقیقاً شکل یک فراخوانی REST را دارد: ورودی ساده می‌گیرد، خروجی `{ ok, ... }` یا یک resource برمی‌گرداند. **تمام قوانینی که باید سمت سرور باشند از قصد اینجا نوشته شده‌اند**، نه پخش‌شده داخل کامپوننت‌ها.

### متدهای خواندن
| متد | ورودی | خروجی | کاربرد |
|---|---|---|---|
| `getState()` | — | `{ settings, orders, log }` | خواندن کامل وضعیت سیستم |
| `isMarketOpen(settings, mode)` | تنظیمات + `"buy"`/`"sell"` | `boolean` | محاسبه‌ی خالص وضعیت باز/بسته (بدون I/O) |
| `findOrder(code, phone)` | کد سفارش + شماره تماس | سفارش یا `null` | پیگیری سفارش مشتری |

### متدهای معامله (منطق حساس)
| متد | چه‌کاری می‌کند |
|---|---|
| `createQuote(purityKey, mode)` | اعتبارسنجی کامل (توقف اضطراری، ساعات بازار، فعال/غیرفعال بودن محصول، وجود قیمت) و در صورت موفقیت، یک «Quote» با `pricePerGram` و `expiresAt` صادر می‌کند |
| `submitOrder(quote, weight, customer)` | **بازاعتبارسنجی کامل** قبل از ثبت: انقضای Quote، محدوده‌ی وزن، تکمیل بودن اطلاعات مشتری، و مهم‌تر از همه — تطبیق قیمت Quote با قیمت زنده‌ی فعلی (اگر ادمین قیمت را عوض کرده باشد، سفارش رد می‌شود). سپس شماره‌ی سفارش صادر می‌کند و رکورد را می‌سازد |
| `attachReceipt(orderId, file)` | تصویر رسید را به Base64 تبدیل و به سفارش پیوست می‌کند، وضعیت را به «در انتظار تأیید پرداخت» می‌برد |

### متدهای مدیریتی
`login`, `updatePrices`, `updateMarket`, `setEmergencyStop`, `updateSystemSettings`, `updateOrderStatus`, `recordFinalWeight`, `finalizeSellAmount`, `setOrderNote`, `appendLog`, `exportBackup`, `restoreBackup`

نکته‌ی طراحی مهم: `updatePrices` خودش تشخیص می‌دهد که آیا قیمتی واقعاً تغییر کرده، و فقط در آن صورت یک رکورد تاریخچه اضافه و لاگ ثبت می‌کند — این دقیقاً همان منطقی است که باید سمت سرور اجرا شود، نه در کامپوننت فرم.

---

## ۴) Storage فعلی چیست

فقط یک ابزار: **`window.storage`**، API داخلی محیط Artifact (نه localStorage مرورگر). سه کلید استفاده می‌شود، همه با `shared: true` (یعنی بین همه‌ی کاربرانی که این Artifact را باز می‌کنند مشترک است):

| کلید | محتوا |
|---|---|
| `settings` | یک JSON شامل تمام تنظیمات (محصولات، بازار، قفل قیمت، بانک، رمز ادمین) |
| `orders` | آرایه‌ای از تمام سفارش‌ها (خرید و فروش با هم) |
| `activityLog` | آرایه‌ای از لاگ فعالیت‌های ادمین (حداکثر ۳۰۰ مورد نگه داشته می‌شود) |

محدودیت‌های واقعی این Storage:
- هیچ Query یا فیلتر سمت سرور ندارد — هر بار کل کلید خوانده و در حافظه فیلتر می‌شود.
- هیچ Transaction یا قفل همزمانی ندارد — دو نویسنده‌ی هم‌زمان می‌توانند یکدیگر را Overwrite کنند («Last write wins»).
- سقف حجم به ازای هر کلید ۵ مگابایت — چون تصاویر رسید به‌صورت Base64 داخل خودِ آرایه‌ی `orders` ذخیره می‌شوند، با رشد تعداد سفارش‌ها ممکن است این سقف مشکل‌ساز شود.
- هیچ Authentication واقعی روی این storage نیست؛ هرکسی که Artifact را باز کند می‌تواند (از طریق کد) بخواند/بنویسد.

---

## ۵) مدل داده

### Settings
```
{
  products: {
    "9999": { buyPrice, sellPrice, minWeight, maxWeight, buyActive, sellActive,
              priceHistory: [{ time, buyPrice, sellPrice }, ...] },
    "990":  { ...همان ساختار... }
  },
  market: { closeStart, closeEnd, buyEnabled, sellEnabled, emergencyStop },
  priceLockMinutes,
  sellValidityDays,
  bank: { cardNumber, accountNumber, sheba, ownerName },
  sellAddress,
  adminPassword,     // متن ساده — نه Hash
  nextOrderSeq,      // شمارنده‌ی شماره سفارش بعدی
  lastPriceUpdate
}
```

### Order — نوع خرید (`type: "buy"`)
```
{
  id,                 // "SP-1058"
  type: "buy",
  purity,             // "9999" | "990"
  weight, pricePerGram, total,
  name, phone,
  createdAt, lockExpiresAt,
  bankSnapshot: { cardNumber, accountNumber, sheba, ownerName }, // کپی لحظه‌ی ثبت
  receiptImage,       // Base64 یا null
  status,             // یکی از BUY_STATUSES
  adminNote,
  history: [{ status, time }, ...]
}
```

### Order — نوع فروش (`type: "sell"`)
```
{
  id, type: "sell", purity,
  weight, pricePerGram, approxTotal,
  name, phone,
  createdAt, sellValidUntil,
  finalWeight, finalPricePerGram, finalTotal,   // تا زمان ثبت نهایی توسط ادمین، null
  status,             // یکی از SELL_STATUSES
  adminNote,
  history: [{ status, time }, ...]
}
```

### ActivityLog
```
[{ time, action, detail }, ...]
```

---

## ۶) شبیه‌سازی مرورگری در برابر منطق واقعاً Server-Shaped

### کاملاً شبیه‌سازی سمت مرورگر (نباید به همین شکل روی Production بماند)
- **قفل قیمت با ساعت مرورگر**: `expiresAt = Date.now() + ...` با ساعت خودِ مرورگر مشتری محاسبه می‌شود. مشخصات صراحتاً خواسته این کار Server-side باشد — الان نیست، و کاربری که ساعت گوشی‌اش را عقب بکشد می‌تواند تئوریک Quote را طولانی‌تر نگه دارد (چون expiry هم client-side چک می‌شود).
- **Auth ادمین**: مقایسه‌ی متن ساده‌ی رمز (`password === settings.adminPassword`) — نه Hash، نه Session token، نه محدودیت تلاش.
- **بدون Rate limiting**: هیچ محدودیتی روی تعداد درخواست Quote یا تلاش ورود ادمین نیست.
- **بدون HTTPS/امنیت انتقال**: کاملاً به هاستینگ Artifact وابسته، خارج از کنترل این کد.
- **همگام‌سازی «تقریباً زنده»**: هر ۲۰ ثانیه Polling روی `getState()` — نه Push واقعی (WebSocket/SSE).
- **بکاپ دستی**: خروجی/ورودی فایل JSON با کلیک کاربر — نه بکاپ خودکار در محل جدا از سرور.
- **رسید پرداخت به شکل Base64 داخل رکورد سفارش** — در یک Backend واقعی باید در Object Storage جدا (S3/Blob) ذخیره و فقط URL آن در دیتابیس بماند.
- **بدون Rollback/Transaction** هنگام نوشتن هم‌زمان `orders` و `settings` (مثلاً در `submitOrder`) — دو `store.write` جدا هستند، نه یک Transaction اتمی.

### طراحی‌شده به‌شکلی که مستقیم به سمت سرور منتقل شود (فقط بدنه‌ی تابع باید عوض شود)
- تمام اعتبارسنجی‌های `createQuote` و `submitOrder` (ساعات بازار، فعال بودن محصول، محدوده‌ی وزن، تطبیق قیمت زنده) — این‌ها همین الان هم «منطق سرور» هستند، فقط جای اجرا شدن‌شان مرورگر است.
- تشخیص خودکار تغییر قیمت و ثبت خودکار در `priceHistory` داخل `updatePrices`.
- شماره‌گذاری سفارش (`nextOrderSeq`) به‌صورت متمرکز در یک تابع، نه پخش در UI.
- ثبت لاگ فعالیت (`appendLog`) به‌صورت خودکار در هر عملیات مدیریتی.
- مدل داده‌ی سفارش (buy/sell) از قبل دقیقاً به شکل رکورد دیتابیس طراحی شده.

---

## ۷) Endpointهایی که برای Backend واقعی لازم است

نگاشت مستقیم از متدهای `api` به Endpoint واقعی (پیشنهاد REST، قابل تبدیل به GraphQL هم هست):

### Public (مشتری)
| Method | Path | معادل در کد فعلی | بدنه‌ی درخواست | پاسخ |
|---|---|---|---|---|
| `GET` | `/api/storefront` | `getState()` (فقط بخش عمومی settings + محصولات) | — | قیمت‌ها، ساعات بازار، وضعیت باز/بسته |
| `POST` | `/api/quotes` | `createQuote` | `{ purityKey, mode }` | `{ quoteId, pricePerGram, expiresAt }` — **باید signed/opaque token باشد، نه فقط عدد** |
| `POST` | `/api/orders` | `submitOrder` | `{ quoteId, weight, name, phone }` | سفارش ساخته‌شده با کد یکتا |
| `POST` | `/api/orders/:id/receipt` | `attachReceipt` | `multipart/form-data` (فایل تصویر) | سفارش به‌روزشده |
| `GET` | `/api/orders/track` | `findOrder` | Query: `code`, `phone` | سفارش (در صورت تطبیق) |

### Admin (نیازمند Authentication واقعی)
| Method | Path | معادل | بدنه |
|---|---|---|---|
| `POST` | `/api/admin/login` | `login` | `{ password }` → باید JWT/Session برگرداند |
| `PATCH` | `/api/admin/products` | `updatePrices` | آرایه‌ای از `{ key, buyPrice, sellPrice, minWeight, maxWeight, buyActive, sellActive }` |
| `PATCH` | `/api/admin/market` | `updateMarket` | `{ closeStart, closeEnd, buyEnabled, sellEnabled }` |
| `POST` | `/api/admin/market/emergency-stop` | `setEmergencyStop` | `{ flag }` |
| `PATCH` | `/api/admin/settings` | `updateSystemSettings` | `{ priceLockMinutes, sellValidityDays, sellAddress, bank, adminPassword? }` |
| `GET` | `/api/admin/orders` | فیلتر روی `getState().orders` | Query: `type`, `status` |
| `PATCH` | `/api/admin/orders/:id/status` | `updateOrderStatus` | `{ status }` |
| `PATCH` | `/api/admin/orders/:id/final-weight` | `recordFinalWeight` | `{ finalWeight }` |
| `PATCH` | `/api/admin/orders/:id/finalize` | `finalizeSellAmount` | `{ finalPricePerGram }` |
| `PATCH` | `/api/admin/orders/:id/note` | `setOrderNote` | `{ note }` |
| `GET` | `/api/admin/customers` | Aggregate روی `orders` | — |
| `GET` | `/api/admin/price-history/:productKey` | زیرمجموعه‌ی `products[key].priceHistory` | — |
| `GET` | `/api/admin/log` | `activityLog` | — |
| `GET` | `/api/admin/backup` | `exportBackup` | — |
| `POST` | `/api/admin/backup/restore` | `restoreBackup` | فایل JSON |

### پیشنهاد جدول‌های دیتابیس (خلاصه)
```
products      (key, buy_price, sell_price, min_weight, max_weight, buy_active, sell_active)
price_history (id, product_key, buy_price, sell_price, created_at)
orders        (id, type, purity, weight, price_per_gram, total, name, phone,
               status, created_at, lock_expires_at, sell_valid_until,
               final_weight, final_price_per_gram, final_total,
               receipt_url, admin_note, bank_snapshot_json)
order_history (id, order_id, status, created_at)
settings      (key, value_json)          -- یا جدول‌های جدا برای market/bank/lock config
activity_log  (id, action, detail, created_at)
admin_users   (id, username, password_hash, ...)
```

### تغییرات ضروری امنیتی هنگام پیاده‌سازی واقعی
- Quote باید یک شناسه‌ی مات (opaque id) یا JWT کوتاه‌مدت باشد که سرور امضا می‌کند، نه فقط یک عدد قیمت که کلاینت نگه می‌دارد.
- تاریخ/ساعت انقضا فقط باید سمت سرور چک شود (کلاینت فقط نمایش می‌دهد).
- رمز ادمین باید Hash شود (bcrypt/argon2) و ورود باید Session/JWT واقعی برگرداند.
- آپلود رسید باید به Object Storage برود، نه Base64 داخل دیتابیس.
- تمام Endpointهای Admin باید پشت Middleware احراز هویت باشند.

---

## ۸) جمع‌بندی یک‌خطی برای هر بخش

| بخش | وضعیت |
|---|---|
| منطق کسب‌وکار (اعتبارسنجی، محاسبه، قوانین) | **آماده‌ی انتقال** — فقط جای اجرا عوض می‌شود |
| مدل داده (Order/Settings) | **آماده‌ی انتقال** — تقریباً معادل مستقیم جدول دیتابیس |
| لایه‌ی `api` | **آماده‌ی انتقال** — هر متد = یک Endpoint |
| Storage (`window.storage`) | **باید کامل جایگزین شود** — با دیتابیس واقعی |
| قفل قیمت / تایمر | **باید سمت سرور بازنویسی شود** — الان فقط نمایش سمت مرورگر |
| Auth ادمین | **باید کامل بازنویسی شود** — الان هیچ امنیت واقعی ندارد |
| آپلود رسید | **باید به Object Storage منتقل شود** |
| همگام‌سازی زنده | **باید به WebSocket/SSE تبدیل شود** — الان Polling ۲۰ ثانیه‌ای |
| بکاپ | **باید خودکار و خارج از سرور شود** — الان فقط دستی |
