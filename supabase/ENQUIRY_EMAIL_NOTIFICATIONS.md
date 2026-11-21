# Finom Healthcare — enquiry email notifications

**Supabase project:** Finom1 (`rtcdmctwoiajkzyrdcit`)
**Table:** `public.website_enquiries` (INSERT only)
**Edge Function:** `notify-new-enquiry`
**Recipient:** `finomhealthcare@gmail.com` (override with `ENQUIRY_NOTIFICATION_EMAIL`)

Enquiry rows are created by the existing website form (`index.html` → `website_enquiries` insert).
This pipeline sends **one** Resend email per new row. Historical rows are not backfilled.

---

## Verified website → database mapping

From `index.html` (unchanged by this feature):

| Form field     | DB column      |
|----------------|----------------|
| `name`         | `name`         |
| `company`      | `company`      |
| `email`        | `email`        |
| `phone`        | `phone`        |
| `enquiryType`  | `enquiry_type` |
| `message`      | `message`      |

The webhook payload also includes server columns (typically `id`, `created_at`).

---

## Prerequisites (do these before deploy)

1. **Resend**
   - Create API key → store only in Supabase secrets (never in git).
   - Verify the domain you will send from.
   - Set `ENQUIRY_FROM_EMAIL` to an address on that verified domain (e.g. `enquiries@yourdomain.com`).

2. **Supabase CLI** (v2.79+ recommended)
   ```powershell
   npm install -g supabase
   supabase login
   ```

3. **Optional extra webhook hardening**
   - Generate a long random string for `ENQUIRY_WEBHOOK_SECRET`.
   - Add the same value as HTTP header `x-enquiry-webhook-secret` on the Database Webhook (see below).

---

## 1. Apply deduplication migration

From the repo root (`finomwebsite`):

```powershell
cd path\to\finomwebsite
npx supabase link --project-ref rtcdmctwoiajkzyrdcit
npx supabase db push
```

This creates `public.website_enquiry_notification_deliveries` (RLS on, no public policies).

---

## 2. Set Edge Function secrets

In [Dashboard → Edge Functions → Secrets](https://supabase.com/dashboard/project/rtcdmctwoiajkzyrdcit/settings/functions), or via CLI:

```powershell
npx supabase secrets set `
  RESEND_API_KEY="re_xxxxxxxx" `
  ENQUIRY_NOTIFICATION_EMAIL="finomhealthcare@gmail.com" `
  ENQUIRY_FROM_EMAIL="Finom Healthcare <enquiries@mail.finomhealthcare.com>" `
  ENQUIRY_WEBHOOK_SECRET="your-long-random-secret"
```

Omit `ENQUIRY_WEBHOOK_SECRET` if you rely only on the Supabase secret API key on the webhook.

---

## 3. Deploy the Edge Function

```powershell
npx supabase functions deploy notify-new-enquiry --no-verify-jwt
```

`supabase/config.toml` sets `verify_jwt = false` because Database Webhooks authenticate with the **secret** `apikey` header. The function uses `withSupabase({ auth: ['secret'] })`.

---

## 4. Create Database Webhook (INSERT only)

[Database Webhooks](https://supabase.com/dashboard/project/rtcdmctwoiajkzyrdcit/integrations/webhooks/overview)

| Setting | Value |
|--------|--------|
| Name | `notify-new-enquiry-insert` |
| Table | `public.website_enquiries` |
| Events | **Insert** only (not Update/Delete) |
| Type | **Supabase Edge Functions** |
| Function | `notify-new-enquiry` |
| Method | `POST` |
| HTTP headers | **Add secret key** (adds `apikey` with your project secret key) |
| Optional | Custom header `x-enquiry-webhook-secret`: same value as `ENQUIRY_WEBHOOK_SECRET` |

Do **not** run a bulk re-send on existing rows; only new INSERTs after the webhook is active will notify.

---

## 5. Test

1. Open the live site contact form.
2. Submit a test enquiry (use a real email you control for Reply-To verification).
3. **Supabase → Table Editor → `website_enquiries`:** confirm a new row.
4. **Table `website_enquiry_notification_deliveries`:** one row with `delivery_status = sent`.
5. **Inbox `finomhealthcare@gmail.com`:** exactly one email with all fields and Reply-To set to the customer email.
6. **Edge Functions → `notify-new-enquiry` → Logs:** no secret values in logs.

If email fails, the enquiry row still persists (INSERT completes before the async webhook). The function returns **500** so `pg_net` may retry; deduplication allows retry when `delivery_status` is `failed` or `pending`. Fix Resend/domain issues, then submit a **new** enquiry or wait for webhook retries.

---

## Security notes

- Secrets exist only in Supabase Edge Function secrets.
- Frontend keeps the **publishable** key only; no Resend or webhook secrets in `index.html`.
- Duplicate webhook deliveries: prevented via `website_enquiry_notification_deliveries` + Resend `Idempotency-Key`.

## Production-specific schema correction

The production audit confirmed `public.website_enquiries.id` is `bigint`.
The delivery migration therefore uses `enquiry_id bigint` and a matching foreign key.
The migration filename is dated `20261121130000`, after the already-applied
production migration `20261120132612_create_website_enquiries_table`.

The Edge Function normalizes the webhook record ID to a string before HTML escaping
and uses that normalized value for delivery tracking and the Resend idempotency key.

## Webhook authentication

The function uses `withSupabase({ auth: ["secret"] }, ...)`, which expects the
project's default Supabase secret API key in the `apikey` header. In the Database
Webhook UI, choose **Add secret key**. The optional `ENQUIRY_WEBHOOK_SECRET`
environment secret adds a second check via `x-enquiry-webhook-secret`; only set
that secret if you also configure the matching custom header on the webhook.
