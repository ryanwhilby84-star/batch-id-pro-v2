# Batch ID Pro — VPS integration status

The React development branch now uses `src/ZtackBatchApp.tsx` rather than the old Supabase application.

## Implemented in this branch
- New responsive ZTACK dashboard and docket list/search
- Draft docket creation, shipment dispatch/lock action, receipt QR confirmation interface
- Account login, company registration, email verification, resend verification, forgot/reset password screens
- Credentialed HTTPS API client; no Supabase SDK calls in the new entrypoint
- Migrated-account sign-in accepts old password lengths; new passwords require 12+ characters

## Not yet implemented or validated
- The existing VPS backend is not included in this GitHub repository. The routes documented in `ZTACK_VPS_MIGRATION.md` are a **proposed contract**, not confirmed live endpoints.
- No SMTP integration or server-side verification tokens have been installed.
- No live API wiring, database regression tests, deployment or email-delivery test has been completed.
- Docket field shapes and lifecycle operations require reconciliation with the existing VPS backend, including its restored legacy records.
- Public registration must remain disabled until server-side verification and abuse controls are complete.

## Required deployment configuration
`VITE_BATCH_API_URL=https://batch-api.ztack.co.uk`

Do not merge or deploy this branch to production until the backend contract, Nginx HTTPS, CORS/CSRF, email provider and E2E tests are complete. Preserve Studio and Outreach configurations.
