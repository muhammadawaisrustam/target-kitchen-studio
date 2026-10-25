import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { EnquiryInputSchema } from "@/lib/enquiries/schema";
import { buildEnquiry } from "@/lib/server/enquiries";
import { buildEnquiryEmail, DEFAULT_QUOTE_EMAIL_TO, EmailFailedError, getMailer, ResendMailer, SmtpMailer } from "@/lib/server/mailer";
import { submitEnquiry } from "@/lib/server/submitEnquiry";
import type { EnquiryStore } from "@/lib/server/enquiryStore";
import { encodeShareToken } from "@/lib/designs/share";

const products = [
  { id: "a", panelCode: "1-026-T18-C-J-1", productName: "GARDEN OAK", category: "Woodgrains", colourFamily: "Beige", finish: "Not stated", brand: "Kastamonu", board: "Particleboard", isActive: true, isPublished: true, isDemo: false },
] as never[];

const enquiry = () =>
  buildEnquiry(
    EnquiryInputSchema.parse({
      name: "Awais <script>alert(1)</script>",
      phone: "+974 5555 1234",
      email: "buyer@example.com",
      message: "Call after 5pm & bring samples",
      consent: true,
      design: {
        modelId: "demo-l-island",
        designName: "Villa",
        selections: { lower_cabinets: "1-026-T18-C-J-1" },
        shareUrl: `https://x.test/?design=${encodeShareToken({ modelId: "demo-l-island", selections: { lower_cabinets: "1-026-T18-C-J-1" } })}`,
      },
    }),
    products,
  );

test("email content: reference, panel code, link, escaped HTML, one-line subject", () => {
  const e = enquiry();
  const m = buildEnquiryEmail(e, "https://studio.test/");
  assert.match(m.subject, new RegExp(e.reference));
  assert.ok(!/[\r\n]/.test(m.subject));
  assert.match(m.text, /1-026-T18-C-J-1 GARDEN OAK/);
  assert.match(m.text, /https:\/\/studio\.test\/\?design=/);
  assert.ok(!m.html.includes("<script>"), "customer text must be escaped");
  assert.match(m.html, /&lt;script&gt;/);
  assert.match(m.html, /after 5pm &amp; bring/);
  assert.equal(m.replyTo, "buyer@example.com");
});

test("Resend: posts to /emails with key, recipient and idempotency key; requires an id back", async () => {
  const e = enquiry();
  let seen: { url: string; init: RequestInit } | undefined;
  const ok = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify({ id: "re_123" }), { status: 200 });
  }) as unknown as typeof fetch;
  const r = await new ResendMailer("re_key", "info@targetqatar.com", "Studio <onboarding@resend.dev>", ok).send(e, "https://s.test");
  assert.equal(r.id, "re_123");
  assert.equal(seen!.url, "https://api.resend.com/emails");
  const h = seen!.init.headers as Record<string, string>;
  assert.equal(h.Authorization, "Bearer re_key");
  assert.equal(h["Idempotency-Key"], e.id);
  const body = JSON.parse(String(seen!.init.body));
  assert.deepEqual(body.to, ["info@targetqatar.com"]);
  assert.equal(body.reply_to, "buyer@example.com");

  const refused = (async () => new Response(JSON.stringify({ message: "You can only send testing emails to your own email address" }), { status: 403 })) as unknown as typeof fetch;
  await assert.rejects(new ResendMailer("k", "x@y.z", "f", refused).send(e, "o"), (err: Error) => err instanceof EmailFailedError && /403/.test(err.message) && /own email/.test(err.message));
  const noId = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(new ResendMailer("k", "x@y.z", "f", noId).send(e, "o"), EmailFailedError);
  const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
  await assert.rejects(new ResendMailer("k", "x@y.z", "f", down).send(e, "o"), /could not be reached/);
});

/** A tiny SMTP server that records what it receives. */
function fakeSmtp(rejectRcpt = false) {
  const received: { auth?: string; rcpt: string[]; data: string } = { rcpt: [], data: "" };
  const server = net.createServer((sock) => {
    let inData = false;
    let buf = "";
    sock.write("220 fake ESMTP\r\n");
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === ".") { inData = false; sock.write("250 2.0.0 queued as FAKE1\r\n"); }
          else received.data += line + "\n";
          continue;
        }
        const cmd = line.toUpperCase();
        if (cmd.startsWith("EHLO")) sock.write("250-fake\r\n250 AUTH PLAIN LOGIN\r\n");
        else if (cmd.startsWith("AUTH PLAIN")) { received.auth = Buffer.from(line.split(" ")[2] ?? "", "base64").toString(); sock.write("235 ok\r\n"); }
        else if (cmd.startsWith("MAIL FROM")) sock.write("250 ok\r\n");
        else if (cmd.startsWith("RCPT TO")) { received.rcpt.push(line); sock.write(rejectRcpt ? "550 no such user\r\n" : "250 ok\r\n"); }
        else if (cmd === "DATA") { inData = true; sock.write("354 go\r\n"); }
        else if (cmd === "QUIT") { sock.write("221 bye\r\n"); sock.end(); }
        else sock.write("250 ok\r\n");
      }
    });
  });
  return new Promise<{ port: number; received: typeof received; close: () => void }>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ port: (server.address() as net.AddressInfo).port, received, close: () => server.close() })),
  );
}

test("SMTP: logs in and delivers to the recipient; a rejected recipient is a failure", async () => {
  const srv = await fakeSmtp();
  try {
    const m = new SmtpMailer({ host: "127.0.0.1", port: srv.port, user: "info@targetqatar.com", pass: "pw", secure: false }, "info@targetqatar.com", "Studio <info@targetqatar.com>");
    const r = await m.send(enquiry(), "https://s.test");
    assert.ok(r.id);
    assert.equal(srv.received.auth, "\0info@targetqatar.com\0pw");
    assert.match(srv.received.rcpt.join(), /info@targetqatar\.com/);
    assert.match(srv.received.data, /Quotation request ENQ-/);
  } finally { srv.close(); }
  const bad = await fakeSmtp(true);
  try {
    const m = new SmtpMailer({ host: "127.0.0.1", port: bad.port, user: "u", pass: "p", secure: false }, "info@targetqatar.com", "f@x.y");
    await assert.rejects(m.send(enquiry(), "o"), EmailFailedError);
  } finally { bad.close(); }
});

test("getMailer: SMTP wins over Resend, default recipient, none without settings", () => {
  assert.equal(getMailer({} as unknown as NodeJS.ProcessEnv), null);
  const r = getMailer({ RESEND_API_KEY: "k" } as unknown as NodeJS.ProcessEnv)!;
  assert.equal(r.kind, "resend");
  assert.equal(r.to, DEFAULT_QUOTE_EMAIL_TO);
  const s = getMailer({ RESEND_API_KEY: "k", SMTP_HOST: "h", SMTP_USER: "u", SMTP_PASS: "p", QUOTE_EMAIL_TO: "sales@x.qa" } as unknown as NodeJS.ProcessEnv)!;
  assert.equal(s.kind, "smtp");
  assert.equal(s.to, "sales@x.qa");
});

test("submitEnquiry: received when either the store or the email is confirmed", async () => {
  const e = enquiry();
  const store = (fail: boolean): EnquiryStore => ({ kind: "file", create: async (x: unknown) => { if (fail) throw new Error("read-only disk"); return x; }, list: async () => [], update: async () => null }) as unknown as EnquiryStore;
  const mail = (fail: boolean) => ({ kind: "resend" as const, to: "t", send: async () => { if (fail) throw new Error("refused"); return { id: "1" }; } });
  let r = await submitEnquiry(e, store(true), mail(false), "o");
  assert.deepEqual([r.stored, r.emailed], [false, true]);
  assert.match(r.problems.join(), /read-only disk/);
  r = await submitEnquiry(e, store(false), null, "o");
  assert.deepEqual([r.stored, r.emailed], [true, false]);
  r = await submitEnquiry(e, store(true), mail(true), "o");
  assert.deepEqual([r.stored, r.emailed], [false, false]);
  assert.equal(r.problems.length, 2);
  r = await submitEnquiry(e, store(false), mail(false), "o");
  assert.deepEqual([r.stored, r.emailed, r.problems.length], [true, true, 0]);
});
