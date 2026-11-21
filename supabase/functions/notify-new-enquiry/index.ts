import { withSupabase } from "npm:@supabase/server@1";

/** Row shape for public.website_enquiries (from form insert + DB defaults). */
type WebsiteEnquiryRecord = {
  id: number | string;
  created_at?: string;
  name?: string;
  company?: string | null;
  email?: string;
  phone?: string | null;
  enquiry_type?: string;
  message?: string;
};

type DatabaseWebhookPayload = {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: WebsiteEnquiryRecord | null;
  old_record: WebsiteEnquiryRecord | null;
};

const ENQUIRY_TYPE_LABELS: Record<string, string> = {
  product: "Product Enquiry",
  distribution: "Distribution Partnership",
  collaboration: "Business Collaboration",
  general: "General Enquiry",
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function formatEnquiryType(raw: string | undefined): string {
  const key = (raw ?? "").trim().toLowerCase();
  if (!key) return "—";
  return ENQUIRY_TYPE_LABELS[key] ?? raw ?? "—";
}

function formatSubmittedAt(record: WebsiteEnquiryRecord): string {
  const iso = record.created_at;
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      dateStyle: "full",
      timeStyle: "long",
      timeZone: "Asia/Kolkata",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function verifyOptionalWebhookSecret(req: Request): Response | null {
  const expected = Deno.env.get("ENQUIRY_WEBHOOK_SECRET");
  if (!expected) return null;

  const provided =
    req.headers.get("x-enquiry-webhook-secret") ??
    req.headers.get("x-webhook-secret") ??
    "";
  if (!provided || !constantTimeEqual(provided, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}

function buildEmailBodies(record: WebsiteEnquiryRecord): {
  subject: string;
  html: string;
  text: string;
} {
  const customerName = (record.name ?? "").trim() || "—";
  const customerEmail = (record.email ?? "").trim() || "—";
  const phone = (record.phone ?? "").trim() || "—";
  const company = (record.company ?? "").trim() || "—";
  const enquiryType = formatEnquiryType(record.enquiry_type);
  const message = (record.message ?? "").trim() || "—";
  const submittedAt = formatSubmittedAt(record);
  const enquiryId = String(record.id);

  const subject = `New website enquiry from ${customerName} (${enquiryType})`;

  const text = [
    "New Finom Healthcare website enquiry",
    "",
    `Customer name: ${customerName}`,
    `Customer email: ${customerEmail}`,
    `Phone number: ${phone}`,
    `Company: ${company}`,
    `Enquiry type: ${enquiryType}`,
    `Submitted at: ${submittedAt}`,
    `Enquiry ID: ${enquiryId}`,
    "",
    "Message:",
    message,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<body style="font-family:Inter,Arial,sans-serif;color:#172B3A;line-height:1.5;">
  <h2 style="color:#123B70;margin:0 0 1rem;">New Finom Healthcare website enquiry</h2>
  <table style="border-collapse:collapse;width:100%;max-width:640px;">
    <tr><td style="padding:6px 8px;font-weight:600;">Customer name</td><td style="padding:6px 8px;">${escapeHtml(customerName)}</td></tr>
    <tr><td style="padding:6px 8px;font-weight:600;">Customer email</td><td style="padding:6px 8px;">${escapeHtml(customerEmail)}</td></tr>
    <tr><td style="padding:6px 8px;font-weight:600;">Phone number</td><td style="padding:6px 8px;">${escapeHtml(phone)}</td></tr>
    <tr><td style="padding:6px 8px;font-weight:600;">Company</td><td style="padding:6px 8px;">${escapeHtml(company)}</td></tr>
    <tr><td style="padding:6px 8px;font-weight:600;">Enquiry type</td><td style="padding:6px 8px;">${escapeHtml(enquiryType)}</td></tr>
    <tr><td style="padding:6px 8px;font-weight:600;">Submitted at</td><td style="padding:6px 8px;">${escapeHtml(submittedAt)}</td></tr>
    <tr><td style="padding:6px 8px;font-weight:600;">Enquiry ID</td><td style="padding:6px 8px;font-family:monospace;">${escapeHtml(enquiryId)}</td></tr>
  </table>
  <h3 style="color:#123B70;margin:1.5rem 0 0.5rem;">Message</h3>
  <p style="white-space:pre-wrap;margin:0;border-left:4px solid #079BCB;padding-left:12px;">${escapeHtml(message)}</p>
</body>
</html>`;

  return { subject, html, text };
}

async function sendResendEmail(
  record: WebsiteEnquiryRecord,
): Promise<{ id?: string }> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const to = Deno.env.get("ENQUIRY_NOTIFICATION_EMAIL") ?? "finomhealthcare@gmail.com";
  const from = Deno.env.get("ENQUIRY_FROM_EMAIL");

  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  if (!from) {
    throw new Error("ENQUIRY_FROM_EMAIL is not configured");
  }

  const { subject, html, text } = buildEmailBodies(record);
  const customerEmail = (record.email ?? "").trim();
  const payload: Record<string, unknown> = {
    from,
    to: [to],
    subject,
    html,
    text,
  };

  if (isValidEmail(customerEmail)) {
    payload.reply_to = customerEmail;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `website-enquiry-${record.id}`,
    },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof body === "object" && body !== null && "message" in body
        ? String((body as { message: unknown }).message)
        : `Resend HTTP ${res.status}`;
    throw new Error(message);
  }

  return body as { id?: string };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdminClient = any;

async function claimDeliverySlot(
  supabaseAdmin: SupabaseAdminClient,
  enquiryId: string,
): Promise<"send" | "skip" | "retry"> {
  const insertResult = await supabaseAdmin
    .from("website_enquiry_notification_deliveries")
    .insert({ enquiry_id: enquiryId, delivery_status: "pending" })
    .select("enquiry_id")
    .single();

  if (!insertResult.error) {
    return "send";
  }

  if (insertResult.error.code !== "23505") {
    console.error(
      "notification delivery log insert failed",
      insertResult.error.code ?? "unknown",
    );
    // Fail closed: do not send without claiming a delivery-log row.
    throw new Error("notification delivery log insert failed");
  }

  const existing = await supabaseAdmin
    .from("website_enquiry_notification_deliveries")
    .select("delivery_status")
    .eq("enquiry_id", enquiryId)
    .maybeSingle();

  const status = existing.data?.delivery_status;
  if (status === "sent") return "skip";
  if (status === "failed" || status === "pending") return "retry";
  return "skip";
}

async function markDelivery(
  supabaseAdmin: SupabaseAdminClient,
  enquiryId: string,
  status: "sent" | "failed",
  resendId?: string,
): Promise<void> {
  const result = await supabaseAdmin
    .from("website_enquiry_notification_deliveries")
    .update({
      delivery_status: status,
      resend_id: resendId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("enquiry_id", enquiryId);

  if (result.error) {
    console.error(
      "notification delivery log update failed",
      result.error.code ?? "unknown",
    );
  }
}

const handler = async (
  req: Request,
  ctx: { supabaseAdmin: SupabaseAdminClient },
) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const secretReject = verifyOptionalWebhookSecret(req);
  if (secretReject) return secretReject;

  let payload: DatabaseWebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  if (
    payload.type !== "INSERT" ||
    payload.schema !== "public" ||
    payload.table !== "website_enquiries"
  ) {
    return Response.json({
      ok: true,
      skipped: true,
      reason: "ignored event",
    });
  }

  const record = payload.record;
  if (!record?.id) {
    return new Response("Missing enquiry record id", { status: 400 });
  }

  const enquiryId = String(record.id);
  const slot = await claimDeliverySlot(ctx.supabaseAdmin, enquiryId);
  if (slot === "skip") {
    return Response.json({ ok: true, duplicate: true });
  }

  try {
    const resend = await sendResendEmail(record);
    await markDelivery(ctx.supabaseAdmin, enquiryId, "sent", resend.id);
    return Response.json({ ok: true, emailed: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "email failed";
    console.error("Enquiry notification email failed", message);
    await markDelivery(ctx.supabaseAdmin, enquiryId, "failed");
    return Response.json(
      { ok: false, emailed: false, error: "email_send_failed" },
      { status: 500 },
    );
  }
};

export default {
  fetch: withSupabase({ auth: ["secret"] }, handler),
};