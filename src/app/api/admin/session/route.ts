import { NextResponse } from "next/server";
import { adminConfig, clearedCookie, createSessionToken, isAdmin, noStore, passwordMatches, sameOrigin, sessionCookie } from "@/lib/server/adminAuth";
import { getEnquiryStore } from "@/lib/server/enquiryStore";
import { clientIp, rateLimit } from "@/lib/server/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET: is admin switched on, and is this browser signed in? */
export async function GET(request: Request) {
  const cfg = adminConfig();
  const signedIn = cfg.enabled && isAdmin(request);
  const store = signedIn ? getEnquiryStore() : null;
  return NextResponse.json(
    { enabled: cfg.enabled, reason: cfg.enabled ? undefined : cfg.reason, signedIn, storage: store ? { kind: store.kind, description: store.description } : undefined },
    { headers: noStore },
  );
}

/** POST { password }: sign in. Five attempts per 15 minutes per address. */
export async function POST(request: Request) {
  const cfg = adminConfig();
  if (!cfg.enabled) return NextResponse.json({ error: cfg.reason }, { status: 503 });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Request blocked: it did not come from this site." }, { status: 403 });
  const limited = rateLimit(`login:${clientIp(request)}`, 5, 15 * 60_000);
  if (!limited.ok) return NextResponse.json({ error: `Too many attempts. Try again in ${Math.ceil(limited.retryAfterSec / 60)} minute(s).` }, { status: 429 });
  const body = (await request.json().catch(() => ({}))) as { password?: unknown };
  if (!passwordMatches(body.password)) return NextResponse.json({ error: "Wrong password." }, { status: 401 });
  return NextResponse.json({ signedIn: true }, { headers: { "Set-Cookie": sessionCookie(request, createSessionToken()), ...noStore } });
}

/** DELETE: sign out. */
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Request blocked." }, { status: 403 });
  return NextResponse.json({ signedIn: false }, { headers: { "Set-Cookie": clearedCookie(request), ...noStore } });
}
