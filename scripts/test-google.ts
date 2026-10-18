/**
 * End-to-end Google OAuth test against a stub issuer.
 *
 *   npm run test:google
 *
 * Spins up a fake Google (authorize / token / userinfo) and the real app with
 * `GOOGLE_*_ENDPOINT` pointed at it, then drives the whole browser dance:
 * redirect -> consent -> callback -> session -> /api/auth/me. PKCE is actually
 * verified, so a broken challenge/verifier pairing fails the test.
 *
 * No Google credentials and no network access required.
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

const APP_PORT = 8791;
const STUB_PORT = 8792;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const STUB_URL = `http://127.0.0.1:${STUB_PORT}`;

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`);
  }
}

/* ------------------------------------------------------------- stub issuer */

interface StubState {
  /** subject -> profile */
  accounts: Map<string, { sub: string; email: string; email_verified: boolean; name?: string }>;
  /** Which account the next /authorize grants access to. */
  activeSub: string | null;
  /** issued authorization codes, with the PKCE challenge Google must verify */
  codes: Map<string, { sub: string; challenge: string; redirectUri: string }>;
  /** what the stub should do when the browser hits /authorize */
  behaviour: "consent" | "deny" | "unverified" | "break_token";
  lastAuthQuery: URLSearchParams | null;
  tokenCalls: number;
}

const stub: StubState = {
  accounts: new Map(),
  activeSub: null,
  codes: new Map(),
  behaviour: "consent",
  lastAuthQuery: null,
  tokenCalls: 0,
};

function stubServer() {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", STUB_URL);

    if (url.pathname === "/o/oauth2/v2/auth") {
      stub.lastAuthQuery = url.searchParams;
      const redirectUri = url.searchParams.get("redirect_uri") ?? "";
      const state = url.searchParams.get("state") ?? "";
      const challenge = url.searchParams.get("code_challenge") ?? "";

      if (stub.behaviour === "deny") {
        res.writeHead(302, {
          location: `${redirectUri}?error=access_denied&state=${encodeURIComponent(state)}`,
        });
        res.end();
        return;
      }

      const account = stub.accounts.get(stub.activeSub ?? "") ?? [...stub.accounts.values()][0]!;
      const code = randomUUID();
      stub.codes.set(code, { sub: account.sub, challenge, redirectUri });
      res.writeHead(302, {
        location: `${redirectUri}?code=${code}&state=${encodeURIComponent(state)}&scope=openid+email+profile`,
      });
      res.end();
      return;
    }

    if (url.pathname === "/token") {
      if (stub.behaviour === "break_token") {
        // Simulate the server having no route to Google: the socket dies.
        req.socket.destroy();
        return;
      }
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        stub.tokenCalls += 1;
        const params = new URLSearchParams(body);
        const code = params.get("code") ?? "";
        const verifier = params.get("code_verifier") ?? "";
        const entry = stub.codes.get(code);

        const fail = (status: number, error: string) => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify({ error }));
        };

        if (!entry) return fail(400, "invalid_grant");
        if (params.get("redirect_uri") !== entry.redirectUri) return fail(400, "redirect_uri_mismatch");

        // Real PKCE check: base64url(sha256(verifier)) must equal the challenge.
        const derived = createHash("sha256").update(verifier).digest("base64url");
        if (derived !== entry.challenge) return fail(400, "invalid_grant");

        stub.codes.delete(code); // authorization codes are single use
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ access_token: `stub-access-${entry.sub}`, token_type: "Bearer", expires_in: 3600 }));
      });
      return;
    }

    if (url.pathname === "/userinfo") {
      const auth = req.headers.authorization ?? "";
      const sub = auth.replace(/^Bearer stub-access-/, "");
      const account = stub.accounts.get(sub);
      if (!account) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_token" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          sub: account.sub,
          email: account.email,
          email_verified: stub.behaviour === "unverified" ? false : account.email_verified,
          name: account.name,
          picture: "https://example.com/avatar.png",
        })
      );
      return;
    }

    res.writeHead(404).end("not found");
  });
}

/* --------------------------------------------------------------- app under test */

function tempDir(): string {
  for (const root of [tmpdir(), join(projectRoot, ".tmp")]) {
    try {
      mkdirSync(root, { recursive: true });
      return mkdtempSync(join(root, "skillry-google-"));
    } catch {
      // next candidate
    }
  }
  throw new Error("no writable temp directory");
}

let appProcess: ReturnType<typeof spawn> | null = null;
let workDir = "";

async function startApp(): Promise<void> {
  workDir = tempDir();
  appProcess = spawn(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", join(projectRoot, "src/server.ts")],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        PORT: String(APP_PORT),
        APP_URL,
        DATABASE_PATH: join(workDir, "app.db"),
        SESSION_SECRET: "test-secret-for-the-google-flow",
        NODE_ENV: "development",
        // Point the app at the stub issuer.
        GOOGLE_CLIENT_ID: "stub-client-id.apps.googleusercontent.com",
        GOOGLE_CLIENT_SECRET: "stub-client-secret",
        GOOGLE_REDIRECT_URI: `${APP_URL}/auth/google/callback`,
        GOOGLE_AUTH_ENDPOINT: `${STUB_URL}/o/oauth2/v2/auth`,
        GOOGLE_TOKEN_ENDPOINT: `${STUB_URL}/token`,
        GOOGLE_USERINFO_ENDPOINT: `${STUB_URL}/userinfo`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  // Drain both pipes: an unread stream can fill the OS buffer and block the child.
  const appLog: string[] = [];
  appProcess.stdout?.on("data", (chunk: Buffer) => appLog.push(chunk.toString()));
  appProcess.stderr?.on("data", (chunk: Buffer) => appLog.push(chunk.toString()));
  process.on("exit", () => {
    if (failures > 0 && appLog.length > 0) {
      // Only surface the child's log when something went wrong.
      console.error("\n  --- app log (tail) ---");
      console.error(appLog.join("").split("\n").slice(-25).join("\n"));
    }
  });

  // Wait for the port to answer.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const res = await fetch(`${APP_URL}/api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("app did not start");
}

function stopApp(): void {
  appProcess?.kill("SIGKILL");
  appProcess = null;
  if (workDir) {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
}

/* ------------------------------------------------------------------ helpers */

let cookies = new Map<string, string>();

function cookieHeader(): string {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

/** Follow one redirect hop manually so we can assert on Location. */
async function beginLogin(next = "/"): Promise<{ status: number; location: string }> {
  const res = await fetch(`${APP_URL}/auth/google?next=${encodeURIComponent(next)}`, {
    redirect: "manual",
    headers: cookies.size ? { cookie: cookieHeader() } : {},
  });
  return { status: res.status, location: res.headers.get("location") ?? "" };
}

async function completeLogin(location: string): Promise<{ status: number; location: string }> {
  const consent = await fetch(location, { redirect: "manual" });
  const callback = consent.headers.get("location");
  if (!callback) throw new Error("stub issuer did not redirect");
  const res = await fetch(callback, { redirect: "manual" });
  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const index = pair.indexOf("=");
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (value) cookies.set(name, value);
    else cookies.delete(name);
  }
  return { status: res.status, location: res.headers.get("location") ?? "" };
}

async function me(): Promise<{ user: unknown; tenants: unknown[]; activeTenantId: string | null; role: string | null }> {
  const res = await fetch(`${APP_URL}/api/auth/me`, { headers: { cookie: cookieHeader() } });
  return (await res.json()) as never;
}

/* --------------------------------------------------------------------- main */

const stubInstance = stubServer();
await new Promise<void>((resolveListen) => stubInstance.listen(STUB_PORT, "127.0.0.1", resolveListen));
await startApp();

console.log("\n  Google OAuth flow (stub issuer)\n");

try {
  /* --- 1. new user signs up with Google --------------------------------- */
  stub.accounts.set("sub-new", {
    sub: "sub-new",
    email: "newcomer@example.com",
    email_verified: true,
    name: "New Comer",
  });
  stub.activeSub = "sub-new";

  const start = await beginLogin("/?from=google");
  check(
    "GET /auth/google redirects to the issuer",
    start.status === 302 && start.location.startsWith(`${STUB_URL}/o/oauth2/v2/auth`),
    `${start.status} ${start.location}`
  );

  // completeLogin drives the stub, so the authorize query is only available after it.
  const done = await completeLogin(start.location);
  const authQuery = stub.lastAuthQuery!;
  check("authorization request carries a state", Boolean(authQuery?.get("state")));
  check("authorization request uses PKCE S256", authQuery?.get("code_challenge_method") === "S256");
  check("authorization request asks for openid email profile", authQuery?.get("scope") === "openid email profile");
  check(
    "authorization request uses the configured redirect_uri",
    authQuery?.get("redirect_uri") === `${APP_URL}/auth/google/callback`
  );

  check("callback redirects into the app", done.status === 302 && done.location === "/?from=google", `${done.status} ${done.location}`);
  check("session cookie issued", cookies.size > 0);

  const firstMe = await me();
  check("user created from the Google profile", (firstMe.user as { email?: string } | null)?.email === "newcomer@example.com");
  check("email marked verified via Google", (firstMe.user as { emailVerified?: boolean } | null)?.emailVerified === true);
  check("personal workspace created", firstMe.tenants.length === 1);
  check("creator is owner", firstMe.role === "owner");
  const firstTenant = firstMe.activeTenantId;
  const firstUserId = (firstMe.user as { id: string }).id;

  /* --- 2. same Google account signs in again ---------------------------- */
  cookies = new Map();
  stub.activeSub = "sub-new";
  const second = await completeLogin((await beginLogin()).location);
  check("second sign-in succeeds", second.status === 302);
  const secondMe = await me();
  check("same user, no duplicate account", (secondMe.user as { id: string }).id === firstUserId);
  check("reuses the same workspace", secondMe.activeTenantId === firstTenant);

  /* --- 3. state is single use ------------------------------------------ */
  const replayState = stub.lastAuthQuery!.get("state")!;
  const replay = await fetch(
    `${APP_URL}/auth/google/callback?code=whatever&state=${encodeURIComponent(replayState)}`,
    { redirect: "manual" }
  );
  const replayQuery = new URLSearchParams((replay.headers.get("location") ?? "").split("?")[1] ?? "");
  check(
    "replaying a consumed state is rejected",
    replay.status === 302 && replayQuery.get("auth_error") === "bad_request",
    `${replay.status} ${replayQuery.get("auth_error")}`
  );

  /* --- 4. linking by verified email ------------------------------------ */
  cookies = new Map();
  const passwordUser = await fetch(`${APP_URL}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "both@example.com",
      password: "correct-horse-battery",
      name: "Both Ways",
    }),
  });
  check("password registration succeeds", passwordUser.status === 201);

  // Capture a session for that password account.
  cookies = new Map();
  const login = await fetch(`${APP_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "both@example.com", password: "correct-horse-battery" }),
  });
  for (const raw of login.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const index = pair.indexOf("=");
    cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
  const beforeLink = await me();
  const passwordUserId = (beforeLink.user as { id: string }).id;

  cookies = new Map();
  stub.accounts.set("sub-both", {
    sub: "sub-both",
    email: "both@example.com",
    email_verified: true,
    name: "Both Ways",
  });
  stub.activeSub = "sub-both";
  await completeLogin((await beginLogin()).location);
  const afterLink = await me();
  check(
    "verified Google email links into the existing password account",
    (afterLink.user as { id: string }).id === passwordUserId
  );
  check("linked account keeps its workspace", afterLink.activeTenantId === beforeLink.activeTenantId);

  /* --- 5. unverified Google email is refused ---------------------------- */
  cookies = new Map();
  stub.behaviour = "unverified";
  stub.accounts.set("sub-unverified", {
    sub: "sub-unverified",
    email: "unverified@example.com",
    email_verified: false,
  });
  stub.activeSub = "sub-unverified";
  stub.behaviour = "unverified";
  const unverified = await completeLogin((await beginLogin()).location);
  const unverifiedQuery = new URLSearchParams(
    (unverified.location ?? "").split("?")[1] ?? ""
  );
  check(
    "unverified Google email is refused",
    unverified.status === 302 && unverifiedQuery.get("auth_error") === "bad_request",
    `${unverified.status} ${unverifiedQuery.get("auth_error")}`
  );
  stub.behaviour = "consent";

  /* --- 6. user denies consent ------------------------------------------ */
  cookies = new Map();
  const denyStart = await beginLogin();
  stub.behaviour = "deny";
  const denied = await completeLogin(denyStart.location);
  check(
    "denied consent redirects back with auth_error",
    denied.status === 302 && denied.location.includes("auth_error=access_denied"),
    denied.location
  );
  stub.behaviour = "consent";

  /* --- 7. PKCE is actually enforced ------------------------------------ */
  check("token endpoint was called for every successful exchange", stub.tokenCalls >= 3, String(stub.tokenCalls));

  /* --- 8. unreachable token endpoint surfaces as a readable redirect ---- */
  cookies = new Map();
  stub.behaviour = "break_token";
  stub.activeSub = "sub-new";
  const broken = await completeLogin((await beginLogin()).location);
  const brokenQuery = new URLSearchParams((broken.location ?? "").split("?")[1] ?? "");
  check(
    "unreachable Google redirects back with google_unreachable",
    broken.status === 302 && brokenQuery.get("auth_error") === "google_unreachable",
    `${broken.status} ${brokenQuery.get("auth_error")}`
  );
  check(
    "the redirect carries a human-readable reason",
    (brokenQuery.get("auth_message") ?? "").includes("无法连接 Google"),
    (brokenQuery.get("auth_message") ?? "").slice(0, 80)
  );
  stub.behaviour = "consent";
} finally {
  stopApp();
  await new Promise<void>((r) => stubInstance.close(() => r()));
}

console.log(`\n  ${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}\n`);
process.exitCode = failures === 0 ? 0 : 1;
