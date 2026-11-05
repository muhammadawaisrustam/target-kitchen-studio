import { NextResponse } from "next/server";
import { noStore, requireAdmin } from "./adminAuth";
import { StorageUnavailableError } from "./enquiryStore";
import { CatalogueEditError } from "./liveCatalogue";

/** Wraps an admin route: checks sign-in and same-site, and turns known errors into clear JSON answers. */
export function adminRoute<C>(fn: (request: Request, ctx: C) => Promise<Response>) {
  return async (request: Request, ctx: C) => {
    const denied = requireAdmin(request);
    if (denied) return denied;
    try {
      return await fn(request, ctx);
    } catch (err) {
      if (err instanceof CatalogueEditError) return NextResponse.json({ error: err.message, details: err.details }, { status: err.status, headers: noStore });
      if (err instanceof StorageUnavailableError) {
        console.error("[admin]", err.message, err.cause);
        return NextResponse.json({ error: err.message }, { status: 503, headers: noStore });
      }
      console.error("[admin] unexpected error", err);
      return NextResponse.json({ error: "Something went wrong. Nothing was changed." }, { status: 500, headers: noStore });
    }
  };
}

export async function readJson<T = Record<string, unknown>>(request: Request, maxBytes = 1_000_000): Promise<T> {
  const text = await request.text();
  if (text.length > maxBytes) throw new CatalogueEditError("The request is too large.", 413);
  try {
    const v = JSON.parse(text) as unknown;
    if (!v || typeof v !== "object") throw new Error();
    return v as T;
  } catch {
    throw new CatalogueEditError("The request could not be read.", 400);
  }
}

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: noStore });
