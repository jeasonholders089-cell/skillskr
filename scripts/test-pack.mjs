/**
 * End-to-end pack delivery test: ticket -> signed URL -> real ZIP, plus the
 * entitlement and signature failure modes. Validates the archive with Python
 * afterwards (independent ZIP implementation).
 */
const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}
function store(res) {
  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const i = pair.indexOf("=");
    jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}

async function json(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(jar.size ? { cookie: cookieHeader() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  store(res);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const email = `pack+${Date.now()}@example.com`;
await json("POST", "/api/auth/register", {
  email,
  password: "pack-test-password",
  workspaceName: "Pack Test",
});

const free = await json("GET", "/api/skills?free=1&limit=1");
const freeSlug = free.data.skills[0].slug;
const pro = await json("GET", "/api/skills?limit=60");
const proSlug = pro.data.skills.find((s) => s.requiresSubscription).slug;

check("catalog has a free and a pro skill", Boolean(freeSlug && proSlug), `${freeSlug} / ${proSlug}`);

/* free skill: allowed for any signed-in member */
const freeTicket = await json("POST", `/api/skills/${freeSlug}/download`);
check("free skill issues a ticket", freeTicket.status === 201 && Boolean(freeTicket.data.url), String(freeTicket.status));

const zipRes = await fetch(BASE + freeTicket.data.url);
const zipBuf = Buffer.from(await zipRes.arrayBuffer());
check("download streams a zip", zipRes.status === 200 && zipBuf.subarray(0, 2).toString() === "PK", String(zipRes.status));
check(
  "content-disposition names the file",
  (zipRes.headers.get("content-disposition") ?? "").includes(freeTicket.data.filename)
);

/* pro skill: blocked without a subscription */
const proTicket = await json("POST", `/api/skills/${proSlug}/download`);
check("pro skill is blocked without a subscription", proTicket.status === 403, String(proTicket.status));

/* grant access, then retry */
await json("POST", "/api/dev/grant", { planCode: "pro_monthly" });
const proTicket2 = await json("POST", `/api/skills/${proSlug}/download`);
check("pro skill issues a ticket with a subscription", proTicket2.status === 201, String(proTicket2.status));

const proZip = await fetch(BASE + proTicket2.data.url);
const proBuf = Buffer.from(await proZip.arrayBuffer());
check("pro download streams a zip", proZip.status === 200 && proBuf.subarray(0, 2).toString() === "PK");

/* signature / expiry failure modes */
const bad = await fetch(BASE + "/api/downloads/not-a-real-token");
check("forged token is rejected", bad.status === 401, String(bad.status));

const tampered = freeTicket.data.url.slice(0, -4) + "AAAA";
const tamperedRes = await fetch(BASE + tampered);
check("tampered signature is rejected", tamperedRes.status === 401, String(tamperedRes.status));

/* unauthenticated */
jar.clear();
const anon = await fetch(BASE + `/api/skills/${freeSlug}/download`, { method: "POST" });
check("anonymous download is rejected", anon.status === 401, String(anon.status));

console.log(`\n  ${failures === 0 ? "all checks passed" : `${failures} failed`}`);
if (zipBuf.length) {
  const fs = await import("node:fs");
  fs.mkdirSync(".tmp", { recursive: true });
  fs.writeFileSync(".tmp/pack-free.zip", zipBuf);
  fs.writeFileSync(".tmp/pack-pro.zip", proBuf);
  console.log(`  wrote .tmp/pack-free.zip (${zipBuf.length}B), pack-pro.zip (${proBuf.length}B)`);
}
process.exitCode = failures === 0 ? 0 : 1;
