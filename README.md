# BPLO Backend

The BPLO backend powers the Business Permit and Licensing Office workflow. It provides the REST API and real-time updates used by the frontend for authentication, permit applications, inspections, assessments, payments, document generation, and account administration.

## Technology

- Node.js, TypeScript, and Express 5
- MongoDB with Mongoose
- Socket.IO for real-time workflow updates
- JWT access tokens with refresh cookies
- Nodemailer, Google sign-in, and Google reCAPTCHA
- PDF generation and GeoIP-based request data

## Prerequisites

- Node.js 20 or newer
- npm
- A reachable MongoDB database
- Mail server credentials and Google OAuth/reCAPTCHA credentials for their respective features

## Getting started

1. Open a terminal in this directory.
2. Install dependencies:

   ```powershell
   npm install
   ```

3. Create a `.env` file using the configuration below. `.env` is intentionally ignored by Git; never commit credentials.
4. Start the development server:

   ```powershell
   npm run dev
   ```

The API listens on `http://localhost:<PORT>`. Confirm it is running with `GET /api/test`.

## Environment variables

All variables marked required are validated when the application starts.

```env
# Runtime and HTTP
NODE_ENV=development
PORT=5000
# Comma-separated frontend origins. Local Vite origins are also allowed outside production.
CORS_ORIGINS=http://localhost:5173

# Database
MONGO_DB_URI=mongodb://127.0.0.1:27017/bplo

# Authentication
JWT_ACCESS_TOKEN=replace-with-a-long-random-secret
JWT_REFRESH_TOKEN=replace-with-a-different-long-random-secret
GOOGLE_CLIENT_ID=your-google-oauth-client-id

# Outgoing email
MAIL_HOST=smtp.example.com
MAIL_PORT=587
MAIL=your-smtp-username-or-email
MAIL_PASSWORD=your-smtp-password

# Security and payments
REFRESH_COOKIE_NAME=refreshToken
REFRESH_COOKIE_PATH=/api/token/refresh
GLOBAL_RATE_LIMIT_MINUTES=15
GLOBAL_RATE_LIMIT_MAX=100
RECAPTCHA_SECRET_KEY=your-recaptcha-secret
PAYMENT_QR_SECRET=optional-secret-used-to-sign-payment-qr-data

# Cloudflare R2 object storage (server-side only)
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your-r2-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
R2_BUCKET=your-r2-bucket-name

# Optional first super-admin account
SEED_SUPER_ADMIN=false
SUPER_ADMIN_EMAIL=admin@example.com
SUPER_ADMIN_PASSWORD=replace-with-a-strong-password
SUPER_ADMIN_FIRST_NAME=Super
SUPER_ADMIN_MIDDLE_NAME=
SUPER_ADMIN_LAST_NAME=Admin
SUPER_ADMIN_SUFFIX=
SUPER_ADMIN_GENDER=Prefer not to say
```

`SEED_SUPER_ADMIN` is optional. When it is `true`, `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD` must be supplied. The remaining super-admin identity fields have safe defaults.

## Available scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the API in watch mode, loading `.env`. |
| `npm run typecheck` | Check TypeScript without emitting files. |
| `npm run build` | Bundle the server into `build/index.js` and copy GeoIP data. |
| `npm run test:env` | Validate the environment configuration contract. |
| `npm run test:auth` | Run authentication regression tests. |
| `npm run test:owner` | Run business-owner workflow regression tests. |
| `npm run test:main-treasurer` | Run main-treasurer payment-confirmation regression tests. |
| `npm run test:bplo-validity` | Run BPLO admin permit-validity regression tests. |

To run the production bundle after building:

```powershell
npm run build
node build/index.js
```

## API overview

All API endpoints are prefixed with `/api`.

| Route group | Purpose |
| --- | --- |
| `/auth` | Registration, login, Google sign-in, password recovery, profile, and logout. |
| `/token` | Refresh access tokens using the refresh cookie. |
| `/super-admin` | Officer accounts, permits, templates, branding, process configuration, and workflow audits. |
| `/bplo-admin` | BPLO dashboard, assessment, approval, inspection routing, permit validity, release, and payment analytics. |
| `/owner` | Permit discovery, applications, statuses, reassessments, and generated documents. |
| `/evaluator` | Application and inspection evaluations. |
| `/inspector` | Inspection scheduling, completion, certificates, release, and audit history. |
| `/department-treasurer` | Department fee assessment and payer management. |
| `/main-treasurer` | Payment monitoring and receipt confirmation. |

Most routes require an access token and enforce a role. The main roles are `super_admin`, `bplo_admin`, `business_owner`, `evaluator`, `inspector`, `department_treasurer`, and `main_treasurer`.

## Project layout

```text
src/
  controllers/  HTTP request handlers by workflow role
  db/           MongoDB connection setup
  env/          Typed and validated environment configuration
  middlewares/  Authentication, roles, rate limits, sanitization, and errors
  models/       Mongoose models
  realtime/     Socket.IO setup
  routes/       API route definitions
  services/     Domain and workflow logic
  tests/        Regression and configuration tests
  utils/        Tokens, mail, PDF, cookies, payments, and shared helpers
```

## Security notes

- Keep all secrets only in environment variables and rotate them if exposed.
- Set `NODE_ENV=production` and configure every deployed frontend URL in `CORS_ORIGINS` before deployment.
- Use strong, distinct JWT secrets and a production MongoDB URI with restricted access.
- The server enables Helmet, global rate limiting, MongoDB query sanitization, strict Mongoose queries, and credentialed CORS.
