# cattle-farm-backend

Node.js + Express + MongoDB (Mongoose), CommonJS, zod.

```bash
npm i
cp .env.example .env      # điền JWT_ACCESS_SECRET, OTP_SECRET, MONGODB_URI
npm run seed              # tạo admin đầu tiên (ADMIN_EMAIL / ADMIN_PASSWORD)
npm run dev               # GET /api/v1/health
npm test                  # verifyAuth + verifyAdmin, không cần MongoDB (model giả trong bộ nhớ)
```

Lưu ý: giao dịch (tạo đơn + snapshot phí + giữ tồn kho) cần MongoDB replica set.

Sau này cần thêm khi làm các module khác: `npm i multer exceljs pdfkit node-cron decimal.js google-auth-library`
