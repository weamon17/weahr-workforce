# WeaHR Backend

Dịch vụ Node.js độc lập xử lý email và chấm công bảo mật. Nó thay thế các
Firebase Callable Functions tương ứng nên hai luồng này không cần nâng cấp
Firebase lên Blaze.

## Kiến trúc và bảo mật

- React chỉ gọi API và không bao giờ nhận Gmail App Password hay service-account.
- API xác thực Firebase ID token trước khi gửi email xác thực.
- Email xác thực luôn lấy từ token/tài khoản Firebase, không lấy địa chỉ đích từ body.
- Firebase Admin tạo action link chính chủ.
- Firestore giới hạn mỗi tài khoản/email một lần gửi trong 60 giây.
- Password reset luôn trả cùng một phản hồi để không làm lộ email có tài khoản hay không.
- CORS chỉ chấp nhận các domain được khai báo trong `ALLOWED_ORIGINS`.
- QR động, GPS, giờ server, ca đã duyệt và giới hạn thiết bị đều được xác thực
  tại backend; React không được phép tự ghi dữ liệu chấm công.
- SMTP được kiểm tra nền và không còn chặn API QR khởi động.

## Chạy local

Yêu cầu Node.js 22+.

1. Firebase Console -> Project settings -> Service accounts -> Generate new private key.
2. Lưu file JSON ngoài repository, ví dụ `C:\secure\weahr-firebase-admin.json`.
3. Sao chép `.env.example` thành `mail-server/.env`.
4. Điền `GMAIL_APP_PASSWORD` và đường dẫn `GOOGLE_APPLICATION_CREDENTIALS`.
5. Trong `.env.local` của frontend, thêm:

```dotenv
VITE_MAIL_API_URL=http://localhost:8787
VITE_BACKEND_API_URL=http://localhost:8787
```

6. Cài và chạy:

```powershell
npm --prefix mail-server install
npm --prefix mail-server run test:smtp
npm run mail:start
npm run verify:attendance-api
```

Chạy frontend ở terminal khác:

```powershell
npm run dev
```

Kiểm tra server:

```powershell
Invoke-RestMethod http://localhost:8787/health
```

Không commit `.env`, App Password hoặc service-account JSON. Nếu một khóa từng bị
commit/public, hãy thu hồi và tạo khóa mới ngay.

## Deploy miễn phí trên Koyeb

Koyeb Free hiện cho phép SMTP mã hóa qua cổng 587. Tạo Web Service từ repository:

- Root directory: `mail-server`
- Build command: `npm ci`
- Run command: `npm start`
- Port: giá trị do Koyeb cấp qua biến `PORT`
- Health path: `/health`

Khai báo các secret:

```text
NODE_ENV=production
ALLOWED_ORIGINS=https://TEN-MIEN-FRONTEND
GMAIL_USER=weahr0426@gmail.com
GMAIL_APP_PASSWORD=APP_PASSWORD_16_KY_TU
MAIL_FROM_NAME=WeaHR
FIREBASE_PROJECT_ID=managementstaff-f0ea6
FIREBASE_CLIENT_EMAIL=...iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
AUTH_CONTINUE_URL=https://TEN-MIEN-FRONTEND
```

Sau khi Koyeb cấp URL, build lại frontend với:

```dotenv
VITE_MAIL_API_URL=https://TEN-SERVICE.koyeb.app
```

Thêm domain frontend vào Firebase Console -> Authentication -> Settings ->
Authorized domains. Free Instance có thể scale-to-zero khi không hoạt động nên
email đầu tiên sau thời gian nghỉ có thể chậm; không nên xem đây là hạ tầng production
có SLA.
