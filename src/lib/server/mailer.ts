import nodemailer, { type Transporter } from "nodemailer";
import type { Enquiry } from "@/lib/enquiries/schema";

/**
 * Emails each quotation request to the sales inbox. Two free options, chosen by which server
 * environment variables are set (never in browser code):
 *
 *  - Resend (free tier): RESEND_API_KEY. Without a verified domain, Resend only delivers to the
 *    email address the Resend account was created with, so sign up with the inbox that should
 *    receive quotes (e.g. info@targetqatar.com).
 *  - SMTP (the company mailbox's own outgoing server): SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.
 *
 * QUOTE_EMAIL_TO sets the recipient (default info@targetqatar.com). QUOTE_EMAIL_FROM sets the sender.
 */
export const DEFAULT_QUOTE_EMAIL_TO = "info@targetqatar.com";

export class EmailFailedError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "EmailFailedError";
  }
}

export interface Mailer {
  kind: "resend" | "smtp";
  to: string;
  send(enquiry: Enquiry, siteOrigin: string): Promise<{ id?: string }>;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** Keeps header values on one line (no header injection through names). */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

export function buildEnquiryEmail(e: Enquiry, siteOrigin: string) {
  const link = e.design.shareToken ? `${siteOrigin.replace(/\/$/, "")}/?design=${e.design.shareToken}` : undefined;
  const subject = oneLine(`Quotation request ${e.reference}: ${e.contact.name}`).slice(0, 200);
  const contact: [string, string | undefined][] = [
    ["Name", e.contact.name],
    ["Phone", e.contact.phone],
    ["Email", e.contact.email],
    ["Company", e.contact.company],
    ["Area", e.contact.location],
    ["Preferred contact", e.contact.preferredContact],
  ];
  const design = [e.design.designName, e.design.variantName, e.design.modelName].filter(Boolean).join(" · ");
  const text = [
    `New quotation request ${e.reference}`,
    `Received ${e.createdAt} (UTC)`,
    "",
    ...contact.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`),
    "",
    `Kitchen: ${design}`,
    ...e.design.items.map((i) => `- ${i.regionLabel}: ${i.panelCode} ${i.productName}${[i.brand, i.board, i.finish].filter(Boolean).length ? ` (${[i.brand, i.board, i.finish].filter(Boolean).join(", ")})` : ""}${i.isDemo ? " [DEMO]" : ""}`),
    ...(link ? ["", `Open this design: ${link}`] : []),
    ...(e.message ? ["", "Notes from the customer:", e.message] : []),
  ].join("\n");
  const row = (k: string, v: string) => `<tr><td style="padding:2px 12px 2px 0;color:#625e57">${esc(k)}</td><td style="padding:2px 0">${v}</td></tr>`;
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#1d1c1a;font-size:14px">
<h2 style="font-weight:normal;margin:0 0 4px">Quotation request <strong>${esc(e.reference)}</strong></h2>
<p style="color:#625e57;margin:0 0 16px">Received ${esc(e.createdAt)} (UTC)</p>
<table>${contact.filter(([, v]) => v).map(([k, v]) => row(k, esc(v))).join("")}</table>
<h3 style="font-weight:normal;margin:20px 0 6px">Kitchen: ${esc(design)}</h3>
<table style="border-collapse:collapse">${e.design.items
    .map((i) => row(i.regionLabel, `<code>${esc(i.panelCode)}</code> ${esc(i.productName)} <span style="color:#625e57">${esc([i.brand, i.board, i.finish].filter(Boolean).join(" · "))}</span>${i.isDemo ? " <b>[DEMO]</b>" : ""}`))
    .join("")}</table>
${link ? `<p style="margin:16px 0"><a href="${esc(link)}">Open this design in the studio</a></p>` : ""}
${e.message ? `<p style="margin:16px 0 4px;color:#625e57">Notes from the customer:</p><p style="white-space:pre-wrap;margin:0">${esc(e.message)}</p>` : ""}
</body></html>`;
  return { subject, text, html, replyTo: e.contact.email };
}

export class ResendMailer implements Mailer {
  kind = "resend" as const;
  constructor(
    private readonly key: string,
    readonly to: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly apiUrl = "https://api.resend.com",
  ) {}

  async send(e: Enquiry, siteOrigin: string) {
    const m = buildEnquiryEmail(e, siteOrigin);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.apiUrl.replace(/\/$/, "")}/emails`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json", "Idempotency-Key": e.id },
        body: JSON.stringify({ from: this.from, to: [this.to], subject: m.subject, text: m.text, html: m.html, reply_to: m.replyTo }),
        cache: "no-store",
      });
    } catch (err) {
      throw new EmailFailedError("The email service could not be reached.", err);
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok || !body.id) throw new EmailFailedError(`The email service refused the message (HTTP ${res.status}${body.message ? `: ${body.message}` : ""}).`);
    return { id: body.id };
  }
}

export class SmtpMailer implements Mailer {
  kind = "smtp" as const;
  private transport: Transporter;
  constructor(opts: { host: string; port: number; user: string; pass: string; secure?: boolean }, readonly to: string, private readonly from: string) {
    this.transport = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.secure ?? opts.port === 465,
      auth: { user: opts.user, pass: opts.pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }

  async send(e: Enquiry, siteOrigin: string) {
    const m = buildEnquiryEmail(e, siteOrigin);
    try {
      const info = await this.transport.sendMail({ from: this.from, to: this.to, subject: m.subject, text: m.text, html: m.html, replyTo: m.replyTo });
      if (!info.accepted?.length) throw new Error(`recipient rejected: ${JSON.stringify(info.rejected)}`);
      return { id: info.messageId };
    } catch (err) {
      throw new EmailFailedError("The email could not be sent through the mail server.", err);
    }
  }
}

let cached: { key: string; mailer: Mailer | null } | null = null;

/** The configured mailer, or null when no email settings are present. */
export function getMailer(env: NodeJS.ProcessEnv = process.env): Mailer | null {
  const key = [env.RESEND_API_KEY, env.SMTP_HOST, env.SMTP_PORT, env.SMTP_USER, env.SMTP_PASS, env.QUOTE_EMAIL_TO, env.QUOTE_EMAIL_FROM, env.RESEND_API_URL].join("|");
  if (cached?.key === key) return cached.mailer;
  const to = env.QUOTE_EMAIL_TO || DEFAULT_QUOTE_EMAIL_TO;
  let mailer: Mailer | null = null;
  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) {
    mailer = new SmtpMailer(
      { host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), user: env.SMTP_USER, pass: env.SMTP_PASS, secure: env.SMTP_SECURE ? env.SMTP_SECURE === "true" : undefined },
      to,
      env.QUOTE_EMAIL_FROM || `Target Kitchen Studio <${env.SMTP_USER}>`,
    );
  } else if (env.RESEND_API_KEY) {
    mailer = new ResendMailer(env.RESEND_API_KEY, to, env.QUOTE_EMAIL_FROM || "Target Kitchen Studio <onboarding@resend.dev>", fetch, env.RESEND_API_URL || undefined);
  }
  cached = { key, mailer };
  return mailer;
}
