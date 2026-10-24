import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { adminConfig, createSessionToken, passwordMatches, requireAdmin, sameOrigin, verifySessionToken, ADMIN_COOKIE } from "@/lib/server/adminAuth";

const withEnv = async (env: Record<string, string | undefined>, fn: () => unknown | Promise<unknown>) => {
  const old = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(old)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
};

test("admin: off unless a strong-enough password is set on the server", async () => {
  await withEnv({ ADMIN_PASSWORD: undefined }, () => assert.equal(adminConfig().enabled, false));
  await withEnv({ ADMIN_PASSWORD: "short" }, () => {
    assert.equal(adminConfig().enabled, false);
    assert.equal(passwordMatches("short"), false);
  });
  await withEnv({ ADMIN_PASSWORD: "correct horse battery" }, () => {
    assert.equal(adminConfig().enabled, true);
    assert.ok(passwordMatches("correct horse battery"));
    assert.ok(!passwordMatches("correct horse batter"));
    assert.ok(!passwordMatches(undefined));
  });
});

test("admin: session tokens are signed, expire, and die when the password changes", async () => {
  await withEnv({ ADMIN_PASSWORD: "correct horse battery", ADMIN_SESSION_SECRET: undefined }, async () => {
    const now = Date.now();
    const token = createSessionToken(now);
    assert.ok(verifySessionToken(token, now + 1000));
    assert.ok(!verifySessionToken(token, now + 9 * 3600_000), "expired after 8 h");
    const [exp, nonce, sig] = token.split(".");
    assert.ok(!verifySessionToken(`${Number(exp) + 999999}.${nonce}.${sig}`, now), "tampered expiry");
    assert.ok(!verifySessionToken("garbage", now));
    await withEnv({ ADMIN_PASSWORD: "a different password" }, () => assert.ok(!verifySessionToken(token, now + 1000)));
  });
});

test("admin: requests need the cookie and must come from the same site", async () => {
  await withEnv({ ADMIN_PASSWORD: "correct horse battery" }, async () => {
    const token = createSessionToken();
    const req = (method: string, headers: Record<string, string>) => new Request("http://studio.test/api/admin/enquiries", { method, headers: { host: "studio.test", ...headers } });
    assert.equal(requireAdmin(req("GET", {}))?.status, 401);
    assert.equal(requireAdmin(req("GET", { cookie: `${ADMIN_COOKIE}=${token}` })), null);
    assert.equal(requireAdmin(req("PATCH", { cookie: `${ADMIN_COOKIE}=${token}`, origin: "https://evil.test" }))?.status, 403);
    assert.equal(requireAdmin(req("PATCH", { cookie: `${ADMIN_COOKIE}=${token}` }))?.status, 403, "no Origin on a change is refused");
    assert.equal(requireAdmin(req("PATCH", { cookie: `${ADMIN_COOKIE}=${token}`, origin: "http://studio.test" })), null);
    assert.ok(sameOrigin(req("GET", {})));
  });
  await withEnv({ ADMIN_PASSWORD: undefined }, () => assert.equal(requireAdmin(new Request("http://x/api"))?.status, 503));
});

test("admin import: checks against the live catalogue, saves only clean files, and can be removed", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tks-"));
  await withEnv({ DATA_DIR: dir, CATALOGUE_FILE: "data/demo-catalogue.json" }, async () => {
    const repo = await import("@/lib/server/catalogueRepository");
    const header = "id,panelCode,productName,category,colourFamily,finish,brand,textureUrl,isActive,isPublished";
    const good = `${header}\nx-1,X-001,Test Oak,Woodgrain,Light wood,Matt,Test,/demo-assets/textures/demo-wd-001.jpg,true,true\nx-2,X-002,Test White,Plain,White,Matt,Test,,true,true`;
    const clash = `${header}\nx-3,DEMO-WD-001,Clash,Woodgrain,Light wood,Matt,Test,,true,true`;
    const bad = `${header}\nx-4,,No code,Woodgrain,Light wood,Matt,Test,ftp://x/y.gif,true,true`;

    const c1 = await repo.checkImport("Test Brand", "a.csv", good);
    assert.equal(c1.slug, "test-brand");
    assert.equal(c1.report.valid.length, 2);
    assert.equal(c1.report.errors.length, 0);
    assert.ok(c1.report.warnings.some((w) => w.panelCode === "X-002"), "warns about no texture or colour");

    const c2 = await repo.checkImport("Other", "b.csv", clash);
    assert.match(c2.report.errors[0]!.message, /already/);
    const c3 = await repo.checkImport("Other", "c.csv", bad);
    assert.ok(c3.report.errors.length >= 2);
    assert.equal((await repo.saveImport("Other", "c.csv", bad)).report.errors.length > 0, true);
    await assert.rejects(fs.stat(path.join(dir, "catalogue", "other.json")), "file with errors is not written");

    await repo.saveImport("Test Brand", "a.csv", good);
    const cat = await repo.loadCatalogue();
    assert.ok(cat.products.some((p) => p.panelCode === "X-001"));
    assert.equal(cat.sources.find((s) => s.kind === "imported")?.records, 2);
    // re-importing the same name replaces it instead of clashing with itself
    assert.equal((await repo.checkImport("Test Brand", "a.csv", good)).report.errors.length, 0);

    const missing = await repo.checkImport("Img", "d.csv", `${header}\ny-1,Y-001,Img,Woodgrain,Light wood,Matt,Test,/brands/none/missing.jpg,true,true`);
    assert.ok(missing.report.warnings.some((w) => /not found/.test(w.message)));

    assert.ok(await repo.deleteImport("test-brand"));
    assert.ok(!(await repo.loadCatalogue()).products.some((p) => p.panelCode === "X-001"));
    assert.equal(await repo.deleteImport("../etc"), false);
  });
});
