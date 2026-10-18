import type { Request, Response } from "express";
import { config } from "../config.ts";

/* ------------------------------------------------------------------ cookies */

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;

}

export function serializeCookie(
  name: string,
  value: string,
  options: {
    maxAgeSeconds?: number;
    path?: string;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "Lax" | "Strict" | "None";
  } = {}
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? "/"}`);
  if (options.maxAgeSeconds !== undefined) {
    const maxAge = Math.max(0, Math.floor(options.maxAgeSeconds));
    parts.push(`Max-Age=${maxAge}`);
    parts.push(`Expires=${new Date(Date.now() + maxAge * 1000).toUTCString()}`);
  }
  if (options.httpOnly !== false) parts.push("HttpOnly");
  if (options.secure ?? config.session.secureCookie) parts.push("Secure");
  parts.push(`SameSite=${options.sameSite ?? "Lax"}`);
  return parts.join("; ");
}

export function setCookie(res: Response, name: string, value: string, maxAgeSeconds?: number): void {
  const cookie = serializeCookie(name, value, { maxAgeSeconds });
  appendSetCookie(res, cookie);
}

export function clearCookie(res: Response, name: string): void {
  appendSetCookie(res, serializeCookie(name, "", { maxAgeSeconds: 0 }));
}

function appendSetCookie(res: Response, cookie: string): void {
  const existing = res.getHeader("Set-Cookie");
  if (existing === undefined) {
    res.setHeader("Set-Cookie", cookie);
  } else if (Array.isArray(existing)) {
    res.setHeader("Set-Cookie", [...existing, cookie]);
  } else {
    res.setHeader("Set-Cookie", [String(existing), cookie]);
  }
}

export function cookie(req: Request, name: string): string | undefined {
  return parseCookies(req.headers.cookie)[name];
}

/* -------------------------------------------------------------------- misc */

export function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]!.trim();
  }
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoPlusSeconds(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export function isoPlusDays(days: number): string {
  return isoPlusSeconds(days * 86_400);
}

export function isFutureIso(value: string | null | undefined): boolean {
  if (!value) return false;
  return Date.parse(value) > Date.now();
}

/** Absolute URL helper for redirects back into this app. */
export function appUrl(path = "/"): string {
  return new URL(path, config.appUrl).toString();
}

/** Only allow same-origin relative redirects, so `next=` cannot be an open redirect. */
export function safeRedirect(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || value.length === 0) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}
