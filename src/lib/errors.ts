import type { NextFunction, Request, Response } from "express";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, "bad_request", message, details);
export const unauthorized = (message = "Sign in required.") =>
  new HttpError(401, "unauthorized", message);
export const forbidden = (message = "You do not have access to this resource.") =>
  new HttpError(403, "forbidden", message);
export const notFound = (message = "Not found.") => new HttpError(404, "not_found", message);
export const conflict = (message: string) => new HttpError(409, "conflict", message);
export const unavailable = (message: string, details?: unknown) =>
  new HttpError(503, "unavailable", message, details);

/** Wrap an async handler so rejected promises reach the error middleware. */
export function handler(
  fn: (req: Request, res: Response, next: NextFunction) => unknown | Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function errorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (res.headersSent) return;

  if (err instanceof HttpError) {
    // Browser-facing pages get a readable page; APIs keep the JSON envelope.
    if (!req.path.startsWith("/api") && req.accepts("html")) {
      res
        .status(err.status)
        .type("html")
        .send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${err.status} · Skillry</title>
<link rel="stylesheet" href="/assets/styles.css">
<link rel="stylesheet" href="/assets/app-extras.css">
</head><body>
<main class="app__main"><div class="page-shell"><section class="skills-page">
  <span class="eyebrow">Error ${err.status}</span>
  <h1 class="skills-title" style="margin-top:.5rem">${escape(err.message)}</h1>
  <p class="skills-sub" style="margin-top:.75rem">
    <a href="/" style="text-decoration:underline">Back to the homepage</a> ·
    <a href="/skills" style="text-decoration:underline">Browse every Skill</a>
  </p>
</section></div></main>
</body></html>`);
      return;
    }
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details ?? undefined },
    });
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  console.error("[error]", message, err instanceof Error ? err.stack : "");
  res.status(500).json({ error: { code: "internal_error", message: "Something went wrong." } });
}

function escape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Human-readable error text, unwrapping the `cause` chain.
 *
 * Node's fetch collapses everything into "fetch failed"; the useful detail
 * (ECONNREFUSED, ENOTFOUND, EACCES, cert problems) lives in `cause`.
 */
export function formatError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts: string[] = [err.message];
  let cause: unknown = (err as { cause?: unknown }).cause;
  let depth = 0;
  while (cause && depth < 4) {
    const code = (cause as { code?: string }).code;
    const message = cause instanceof Error ? cause.message : String(cause);
    parts.push(code && !message.includes(code) ? `${code}: ${message}` : message);
    cause = (cause as { cause?: unknown }).cause;
    depth += 1;
  }
  return parts.filter(Boolean).join(" -> ");
}
