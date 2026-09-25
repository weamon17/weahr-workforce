# WeaHR

WeaHR is a workforce-management SaaS MVP for cafés and small F&B businesses. It combines secure attendance, constraint-based scheduling, payroll, labor-profitability reporting, and explainable hourly demand forecasts in one responsive web application.

> Current stage: pilot-ready technical MVP. Multi-tenant authorization, self-service organization onboarding, employee invitations, trial-plan metadata, and core workforce workflows are implemented. Payment processing, legal payroll configuration, production monitoring, and validated forecasting models are still roadmap items.

## Product capabilities

### Manager

- Rotating 30–60 second attendance QR, GPS geofence, server timestamps, approved-shift enforcement, device limits, anomaly requests, and manager exception approval
- Attendance and manual timesheet management with edit audit logs
- Full-time and part-time employee profiles
- Shift-request approval and employee notifications
- Configurable weekly registration deadline, reusable skill-aware shift templates (employees can hold several skills), reminders, fair automatic scheduling that preserves approved swaps, salary-based labor-cost estimates, and a transparent Schedule Score
- Open shifts, employee self-claim, conflict/skill checks, and manager-approved replacements
- Payroll calculation with Vietnam Labour Code minimums (150% overtime beyond 8 h/day, 300% public holidays, +30% night work 22:00–06:00), bonus/penalty adjustments, finalization, revision, and payment status
- Labor profitability dashboard: labor-cost ratio, revenue per labor hour, avoidable OT estimate, staffing gaps, branch comparison, and CSV exports
- `.xlsx`/CSV sales import and an explainable same-weekday/hour statistical demand baseline

### Employee

- Installable PWA experience on supported phones and computers, with offline and update status
- Email-verified account registration
- Secure QR check-in/check-out with mandatory high-accuracy location and an approved shift
- Shift and leave requests
- Weekly availability registration and published auto-generated schedules
- Open-shift claiming when availability, skills, and existing assignments allow it
- Personal attendance, payroll, bonus/penalty, and notification views

## Security model

- A business owner can create a new isolated workspace through a trusted callable function and starts a 14-day trial. Managers see a trial countdown; expiry is advisory only and never locks data, because self-service billing is not built yet.
- Employees can only join an organization through a single-email invitation that expires after seven days. Public registration cannot choose or guess a tenant ID.
- Missing or unreadable profiles fail closed; they are never treated as managers.
- Firestore access is restricted by role, owner UID, and `organizationId`.
- Salary and personal HR master data are manager-only.
- Employee-owned records use `employeeId` for ownership checks.
- Employee check-in/check-out writes are denied directly by Firestore and only accepted through the authenticated attendance API in `mail-server/` (`/v1/attendance/*`).
- QR token, expiry, geofence, current shift, server time, and device policy are verified on the server.
- Email verification uses Firebase Authentication. The former browser-generated OTP server was removed.

Firebase Web configuration values are client identifiers, not authorization secrets. Authorization is enforced in [firestore.rules](./firestore.rules).

## Stack

- React 19 + Vite
- Installable Progressive Web App with a same-origin-only service worker
- Firebase Authentication and Cloud Firestore
- Recharts and i18next
- `read-excel-file` for `.xlsx` ingestion; CSV export uses a small local encoder
- Firebase Cloud Functions v2 and Cloud Scheduler

## Project structure

```text
src/            React application
functions/      Trusted onboarding, account and scheduling Firebase backend
mail-server/    Standalone Node API: branded auth email and secure attendance
tests/          Automated application and security tests
scripts/        One-time maintenance and document-generation scripts
docs/           Customer-facing documents and their source assets
public/         Static web assets
```

Local configuration is intentionally limited to `.env.local` for the frontend
and `mail-server/.env` for the email backend. Each has one adjacent
`.env.example`; no other `.env` files are required.

## Local setup

Requirements: Node.js 20+ and a Firebase project with Email/Password authentication enabled.

```bash
npm install
copy .env.example .env.local
npm run dev
```

Fill the `VITE_FIREBASE_*` values from Firebase Console → Project settings → Your apps.

For a read-only local admin demo that never touches Firebase, add these optional
values to the same `.env.local`:

```dotenv
VITE_DEMO_ADMIN_EMAIL=admin@weahr.local
VITE_DEMO_ADMIN_PASSWORD=choose-a-local-password
```

The demo login is accepted only by Vite development mode, uses pre-seeded sample
employees, attendance, schedules, sales and forecasts, and does not require email
verification. `.env.local` is gitignored, and the production branch removes the
demo login path from the bundle. Cloud write/delete actions are blocked while the
demo session is active.

To create an idempotent, email-verified Firebase manager for local write-flow
testing, configure the `TEST_ADMIN_*` values in `.env.local`, ensure
`mail-server/.env` points to a valid Firebase service-account, then run:

```powershell
npm run seed:test-admin
npm run verify:test-admin
```

This creates or updates a dedicated `local-test` organization without modifying
other tenant data.

Create the first organization from the **Tạo workspace doanh nghiệp** action on the login page. The backend creates the organization, owner profile, 14-day trial metadata, and default weekly-scheduling settings atomically. After login, use **Tổ chức** to generate a seven-day employee invitation link.

Install and deploy the backend before creating accounts or running a pilot. The callable functions are required for organization signup, invitations, employee account lifecycle, and synchronized profile renames. Secure attendance and attendance-exception approval are served by the Node backend in `mail-server/`, which must also be deployed. The scheduled functions also deliver weekly reminders and generate schedules when nobody has the web app open:

```bash
npm --prefix functions install
firebase deploy --only functions,firestore:rules,firestore:indexes
```

The scheduled function checks once per hour in the `Asia/Ho_Chi_Minh` timezone. Cloud Scheduler requires billing to be enabled on the Firebase project. A `404` response from a `cloudfunctions.net/<functionName>` endpoint means the backend is not deployed; the corresponding SaaS workflow is not operational until Functions, rules, and indexes are deployed together.

Camera and geolocation require HTTPS in production (localhost is accepted by modern browsers). Before a pilot, the manager must save the store latitude/longitude, geofence radius, QR lifetime, and device limit in the attendance screen. The browser device ID is an MVP risk signal, not hardware attestation; a production mobile app should add App Check and platform attestation.

### Installable app (PWA)

Production builds register `/sw.js` and expose `/manifest.webmanifest`. Supported
browsers will show the in-app **Install WeaHR** prompt after the site satisfies
their installability checks. The service worker only caches same-origin shell and
static assets; Firebase, backend API, attendance writes, payroll writes, and other
cross-origin requests are never cached. When offline, WeaHR may display its latest
cached shell, but all operational writes remain unavailable until connectivity
returns.

### Branded authentication email

Email verification and password-reset links are generated by Firebase Admin in a
standalone Node.js service and sent as **WeaHR <weahr0426@gmail.com>** through
Gmail SMTP. This mail flow does not use Firebase Functions or Secret Manager and
therefore does not require Blaze.

The Gmail App Password and Firebase service-account must exist only in
`mail-server/.env` for local development or in the hosting provider's secret
settings. They must never use a `VITE_` prefix or appear in React source. See
[mail-server/README.md](./mail-server/README.md) for setup, local testing and
Koyeb Free deployment.

Changing the Google Account password revokes existing App Passwords, so create a
new one and update the mail-server secret after such a change. Personal Gmail is
acceptable for a small pilot but has sending/reputation limits; migrate to a
transactional provider and a verified product domain before high-volume
commercial use.

Never put a Firebase Admin service-account key in this frontend repository.

## Data conventions

Every tenant-scoped document contains `organizationId`. Employee-owned documents also contain `employeeId`, the Firebase Auth UID. `employeeName` is only a display snapshot and must not authorize access.

Important collections:

- `users/{uid}`: identity, role, and organization
- `employee_profiles/{uid}`: employee profile and manager-controlled compensation fields
- `employees/{organizationId_employeeKey}`: tenant-scoped HR master record; linked accounts carry the Firebase Auth UID in `employeeId`
- `timesheets`, `schedules`, `payrolls`, `bonuses`, `penalties`, `notifications`, and `audit_logs`
- `schedule_settings`, `availability_submissions`, and `weekly_assignments`: weekly scheduling automation
- `attendance_settings`, `attendance_qr`, `employee_devices`, and `attendance_exceptions`: trusted attendance policy and anomaly workflow
- `shift_swap_requests`: open-shift/replacement approval workflow
- `sales_records`: normalized hourly revenue and order volume by branch

### Existing-data migration

Before deploying these rules to an existing Firebase project:

1. Back up Firestore.
2. Add the correct `organizationId` to all existing users and tenant-scoped documents.
3. Add `employeeId` to employee-owned attendance, payroll, bonus, penalty, and schedule documents.
4. Create and verify `attendance_settings/{organizationId}` from the manager UI.
5. Test manager and employee queries in staging, then deploy rules, indexes, and functions.

Legacy documents without these fields are intentionally inaccessible under the hardened rules.

## Quality checks

```bash
npm run lint
npm run build
npm run check
npm audit
```

## SaaS roadmap

1. Subscription checkout, webhook reconciliation, enforced plan limits, usage metering, and a customer billing portal
2. Move employee master documents from display-name keys to UID keys
3. Configurable payroll policies and compliance review
4. Firebase Emulator integration, CI/CD, monitoring, alerting, backups, App Check, and device attestation
5. Server-side iPOS/KiotViet adapters after API credentials and commercial access are available
6. Train and backtest demand models with holiday, promotion, and weather features after collecting sufficient consented data
7. Compare forecast/optimizer decisions against overtime, understaffing, revenue, and manager overrides in controlled pilots

The current demand module is deliberately an explainable statistical baseline, not a trained forecasting model. It reports sample size, trend, and confidence. It should only be marketed as predictive after backtesting on real, consented operational data and publishing error metrics against this baseline.
