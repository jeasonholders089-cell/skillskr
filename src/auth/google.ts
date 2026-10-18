import type { Request, Response } from "express";
import { config } from "../config.ts";
import { get, run } from "../db.ts";
import { HttpError, badRequest, formatError, handler, unavailable } from "../lib/errors.ts";
import { appUrl, clientIp, nowIso, safeRedirect } from "../lib/http.ts";
import { audit } from "../lib/audit.ts";
import { createPkcePair, generateToken } from "../lib/secrets.ts";
import { outboundFetch } from "../lib/outbound.ts";
import { createWorkspaceForOwner, defaultWorkspaceName, membershipsForUser } from "../repos/tenants.ts";
import {
  createUser,
  findOauthAccount,
  findUserByEmail,
  findUserById,
  linkOauthAccount,
  markEmailVerified,
} from "../repos/users.ts";
import { createSession } from "./sessions.ts";

const STATE_TTL_MS = 10 * 60_000;

/** Turn provider error codes into something a human can act on. */
const ERROR_HINTS: Record<string, string> = {
  access_denied: "你（或该 Google 账号）取消了授权。",
  redirect_uri_mismatch:
    "回调地址不匹配。请把下面这个地址一字不差地加到 Google OAuth 客户端的「已获授权的重定向 URI」里。",
  invalid_client: "GOOGLE_CLIENT_ID 或 GOOGLE_CLIENT_SECRET 不正确。",
  invalid_grant: "授权码无效、已过期或已被使用，请重新发起登录。",
  unauthorized_client: "该 OAuth 客户端类型不支持此流程，请确认创建的是「Web 应用」。",
  unsupported_response_type: "OAuth 客户端类型不对，请确认创建的是「Web 应用」。",
};

export function googleErrorHint(code: string): string {
  return ERROR_HINTS[code] ?? `Google 返回错误：${code}`;
}

interface GoogleUserInfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  locale?: string;
}

/** Step 1: send the browser to Google with state + PKCE. */
export const startGoogleLogin = handler((req: Request, res: Response) => {
  if (!config.google.configured) {
    throw unavailable(
      "Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env."
    );
  }

  const state = generateToken(24);
  const { verifier, challenge } = createPkcePair();
  const redirectTo = safeRedirect(req.query.next, "/");

  run(
    "INSERT INTO oauth_states (state, code_verifier, redirect_to, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    state,
    verifier,
    redirectTo,
    new Date(Date.now() + STATE_TTL_MS).toISOString(),
    nowIso()
  );

  const url = new URL(config.google.authEndpoint);
  url.searchParams.set("client_id", config.google.clientId);
  url.searchParams.set("redirect_uri", config.google.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("access_type", "online");
  url.searchParams.set("prompt", "select_account");

  res.redirect(302, url.toString());
});

/** Step 2: exchange the code, upsert the user, open a session. */
export const googleCallback = handler(async (req: Request, res: Response) => {
  try {
    await completeGoogleLogin(req, res);
  } catch (err) {
    // This route is hit by a browser, not by an API client: a redirect with a
    // readable reason beats a JSON blob on a blank page.
    const code = err instanceof HttpError ? err.code : "internal";
    const message =
      err instanceof HttpError
        ? err.message
        : `Unexpected error during sign-in: ${formatError(err)}`;
    console.error("[google] callback failed:", formatError(err));
    const target = new URL("/", config.appUrl);
    target.searchParams.set("auth_error", code);
    target.searchParams.set("auth_message", message.slice(0, 400));
    res.redirect(302, `${target.pathname}${target.search}`);
  }
});

async function completeGoogleLogin(req: Request, res: Response): Promise<void> {
  if (!config.google.configured) throw unavailable("Google sign-in is not configured.");

  const error = typeof req.query.error === "string" ? req.query.error : null;
  if (error) {
    console.warn(`[google] authorization denied: ${error}`);
    res.redirect(302, `/?auth_error=${encodeURIComponent(error)}`);
    return;
  }

  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  if (!code || !state) throw badRequest("Missing code or state in the OAuth callback.");

  const stateRow = get<{ state: string; code_verifier: string; redirect_to: string | null; expires_at: string }>(
    "SELECT * FROM oauth_states WHERE state = ?",
    state
  );
  // Single use: consume immediately, regardless of the outcome below.
  run("DELETE FROM oauth_states WHERE state = ?", state);

  if (!stateRow) throw badRequest("This sign-in link is no longer valid. Start again.");
  if (Date.parse(stateRow.expires_at) < Date.now()) {
    throw badRequest("This sign-in link expired. Start again.");
  }

  const profile = await exchangeCodeForProfile(code, stateRow.code_verifier);
  const email = (profile.email ?? "").toLowerCase();
  if (!email) throw badRequest("Google did not return an email address for this account.");

  // Google marks addresses it has not verified. Linking such an address to an
  // existing password account would be an account-takeover path, so refuse.
  if (profile.email_verified !== true) {
    throw badRequest(
      `The Google account ${email} has no verified email address, so it cannot be used to sign in. ` +
        "Verify it with Google, or use the email and password flow."
    );
  }

  const linked = findOauthAccount("google", profile.sub);
  let userId: string;

  if (linked) {
    userId = linked.user_id;
  } else {
    // Verified email at a trusted IdP: treat it as the same person.
    const existing = findUserByEmail(email);
    if (existing) {
      userId = existing.id;
      if (!existing.email_verified_at) markEmailVerified(userId);
    } else {
      userId = createUser({
        email,
        name: profile.name ?? null,
        avatarUrl: profile.picture ?? null,
        emailVerified: Boolean(profile.email_verified),
        locale: profile.locale ?? null,
      }).id;
    }
    linkOauthAccount({
      userId,
      provider: "google",
      providerAccountId: profile.sub,
      email,
      profile: { name: profile.name, picture: profile.picture, locale: profile.locale },
    });
  }

  const user = findUserById(userId);
  if (!user) throw badRequest("Could not load the account for this Google identity.");
  if (user.is_disabled) throw badRequest("This account is disabled.");

  // Every user needs at least one workspace to land in.
  let memberships = membershipsForUser(userId);
  if (memberships.length === 0) {
    createWorkspaceForOwner({
      name: defaultWorkspaceName(user.name, email),
      userId,
      email,
      isPersonal: true,
    });
    memberships = membershipsForUser(userId);
  }

  createSession(res, req, userId, memberships[0]?.id ?? null);
  audit({
    tenantId: memberships[0]?.id ?? null,
    actorUserId: userId,
    action: "auth.login.google",
    ip: clientIp(req),
    metadata: { email },
  });

  res.redirect(302, safeRedirect(stateRow.redirect_to, "/"));
}

async function exchangeCodeForProfile(code: string, codeVerifier: string): Promise<GoogleUserInfo> {
  const body = new URLSearchParams({
    code,
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    redirect_uri: config.google.redirectUri,
    grant_type: "authorization_code",
    code_verifier: codeVerifier,
  });

  let tokenResponse: Response;
  try {
    tokenResponse = await outboundFetch(config.google.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (err) {
    throw new HttpError(
      503,
      "google_unreachable",
      "服务端无法连接 Google 的 token 接口，授权码没法换成用户信息。" +
        "（这不是配置问题：浏览器能打开 Google 不代表服务器也能。）" +
        `底层错误：${formatError(err)}`
    );
  }

  if (!tokenResponse.ok) {
    const text = await tokenResponse.text();
    let errorCode = "";
    try {
      errorCode = String((JSON.parse(text) as { error?: string }).error ?? "");
    } catch {
      // non-JSON body: fall through to the raw text
    }
    const hint = errorCode ? ` -- ${googleErrorHint(errorCode)}` : "";
    throw badRequest(
      `Google rejected the token exchange (HTTP ${tokenResponse.status}${errorCode ? `, ${errorCode}` : ""})${hint} ` +
        `回调地址：${config.google.redirectUri}` +
        (errorCode ? "" : ` / 原始响应：${truncate(text)}`)
    );
  }
  const tokens = (await tokenResponse.json()) as { access_token?: string };
  if (!tokens.access_token) {
    throw badRequest("Google did not return an access token. Check that the scope includes 'openid email profile'.");
  }

  let profileResponse: Response;
  try {
    profileResponse = await outboundFetch(config.google.userinfoEndpoint, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
  } catch (err) {
    throw new HttpError(
      503,
      "google_unreachable",
      `服务端无法读取 Google 用户信息：${formatError(err)}`
    );
  }
  if (!profileResponse.ok) {
    throw badRequest(`Could not load the Google profile (${profileResponse.status}).`);
  }
  return (await profileResponse.json()) as GoogleUserInfo;
}

function truncate(value: string, max = 300): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

export const googleStatus = handler((_req: Request, res: Response) => {
  res.json({
    configured: config.google.configured,
    loginUrl: config.google.configured ? appUrl("/auth/google") : null,
  });
});
