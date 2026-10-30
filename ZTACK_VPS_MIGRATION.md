# ZTACK Batch VPS integration — implementation contract

Frontend work started on this branch. DO NOT deploy until the backend implements and tests these routes and the original Supabase-dependent docket screens are migrated.

## Backend endpoints
All endpoints are relative to `VITE_BATCH_API_URL=https://batch-api.ztack.co.uk`.

- `POST /auth/login`: {email,password} -> {user:{id,email,role,company_id,company_name,email_verified}}; sets Secure, HttpOnly, SameSite cookie
- `GET /auth/me`: {user}; returns 401 when unauthenticated
- `POST /auth/logout`: revokes session and clears cookie
- `POST /auth/register`: {company_name,email,password} -> generic acknowledgement; pending account only, no usable session
- `POST /auth/verify-email`: {token} -> {message}; one-use, expiring, hash-at-rest token
- `POST /auth/resend-verification`: {email} -> generic acknowledgement
- `POST /auth/forgot-password`: {email} -> generic acknowledgement
- `POST /auth/reset-password`: {token,password} -> {message}; invalidate all existing sessions

## Security requirements
- Do not enable public registration until email delivery, confirmation, rate limiting and abuse controls pass tests.
- Use a trusted SMTP provider and secret manager; do not put SMTP credentials or signing secrets in Vite env vars.
- CORS must allow only https://batch.ztack.co.uk with credentials; reject untrusted Origin for mutations and enforce CSRF defense.
- Use password hashing and constant-time verification; preserve compatible legacy bcrypt hashes and upgrade them on successful login.
- Do not expose legacy QR receipt tokens; issue new scoped expiring tokens.
- Existing company and docket access must be authorized server-side per session, never from client-supplied company ID.
- Existing data: 1 company, 1 user, 11 active dockets, 47 archived (36 lack a valid company link).
- Verify API, account migration, multi-tenancy, QR flows, email verification, password reset and E2E before production cutover.

## DNS and deployment
Keep the old frontend running while deploying preview. Namecheap A record batch-api -> 212.227.125.159. Add isolated Nginx virtual host with Let's Encrypt. Vercel batch.ztack.co.uk domain configured independently. Do not change Studio/Outreach Nginx entries.
