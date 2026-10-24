import crypto from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Basic admin sign-in, checked on the server.
 *
 * - The password is the ADMIN_PASSWORD environment variable on the server (at least 12
 *   characters). It is never sent to or stored in the browser bundle.
 * - A successful sign-in sets an HttpOnly, SameSite=Strict cookie holding an expiry time signed
 *   with HMAC-SHA256. Changing ADMIN_PASSWORD (or ADMIN_SESSION_SECRET) signs everyone out.
 * - Changes are only accepted from the same site (Origin check) to block cross-site requests.
 *
 * This is one shared password, not individual staff accounts: there is no per-person audit
 * trail, password reset or two-factor sign-in. Serve the site over HTTPS.
 */
export const ADMIN_COOKIE = "tks_admin";
const SESSION_HOURS = 8;
export const MIN_PASSWORD_LENGTH = 12;

export type AdminConfig = { enabled: true } | { enabled: false; reason: string };

export function adminConfig(): AdminConfig {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return { enabled: false, reason: "Admin is switched off: ADMIN_PASSWORD is not set on the server." };
  if (pw.length < MIN_PASSWORD_LENGTH) return { enabled: false, reason: `Admin is switched off: ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  return { enabled: true };
}

const secret = () => process.env.ADMIN_SESSION_SECRET || crypto.createHmac("sha256", "tks-admin-session").update(process.env.ADMIN_PASSWORD ?? "").digest("hex");
const sign = (payload: string) => crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
const sha = (s: string) => crypto.createHash("sha256").update(s).digest();

export function passwordMatches(input: unknown): boolean {
  const cfg = adminConfig();
  if (!cfg.enabled || typeof input !== "string") return false;
  return crypto.timingSafeEqual(sha(input), sha(process.env.ADMIN_PASSWORD!));
}

export function createSessionToken(now = Date.now()): string {
  const payload = `${now + SESSION_HOURS * 3600_000}.${crypto.randomBytes(9).toString("base64url")}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined, now = Date.now()): boolean {
  if (!token || !adminConfig().enabled) return false;
  const i = token.lastIndexOf(".");
  if (i < 0) return false;
  const payload = token.slice(0, i);
  const sig = Buffer.from(token.slice(i + 1));
  const expected = Buffer.from(sign(payload));
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return false;
  const exp = Number(payload.split(".")[0]);
  return Number.isFinite(exp) && exp > now;
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1));
  }
  return undefined;
}

const isHttps = (request: Request) => (request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "")) === "https";

export function sessionCookie(request: Request, token: string): string {
  return `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}${isHttps(request) ? "; Secure" : ""}`;
}
export function clearedCookie(request: Request): string {
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isHttps(request) ? "; Secure" : ""}`;
}

/** Same-site check for state-changing requests. Browsers always send Origin on POST/PATCH/DELETE. */
export function sameOrigin(request: Request): boolean {
  if (["GET", "HEAD"].includes(request.method)) return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const isAdmin = (request: Request) => verifySessionToken(readCookie(request, ADMIN_COOKIE));

/** Returns an error response when the request is not from a signed-in admin, otherwise null. */
export function requireAdmin(request: Request): NextResponse | null {
  const cfg = adminConfig();
  if (!cfg.enabled) return NextResponse.json({ error: cfg.reason }, { status: 503 });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Request blocked: it did not come from this site." }, { status: 403 });
  if (!isAdmin(request)) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  return null;
}

export const noStore = { "Cache-Control": "no-store" };
