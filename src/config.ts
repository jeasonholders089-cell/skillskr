import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

function str(name: string, fallback = ""): string {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? fallback : raw;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

/**
 * Resolve the Pancake private key from whichever of the three supported forms
 * is present. The SDK also normalises PEM headers and literal `\n`, so the raw
 * value is passed through untouched.
 */
function resolvePrivateKey(): string {
  const file = str("WAFFO_PRIVATE_KEY_FILE");
  if (file) {
    try {
      return readFileSync(file, "utf-8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`WAFFO_PRIVATE_KEY_FILE could not be read (${file}): ${message}`);
    }
  }
  const base64 = str("WAFFO_PRIVATE_KEY_BASE64");
  if (base64) {
    return Buffer.from(base64, "base64").toString("utf-8");
  }
  return str("WAFFO_PRIVATE_KEY");
}

const isProduction = str("NODE_ENV", "development") === "production";

const appUrlValue = str("APP_URL", `http://localhost:${int("PORT", 8787)}`);

/**
 * Default the OAuth callback to this app's own origin so changing PORT does not
 * silently break the flow. An explicit GOOGLE_REDIRECT_URI still wins.
 */
function defaultRedirectUri(): string {
  try {
    return new URL("/auth/google/callback", appUrlValue).toString();
  } catch {
    return `http://localhost:${int("PORT", 8787)}/auth/google/callback`;
  }
}

function resolveSessionSecret(): string {
  const secret = str("SESSION_SECRET");
  if (secret) return secret;
  if (isProduction) {
    throw new Error("SESSION_SECRET must be set in production.");
  }
  // Ephemeral dev secret: sessions reset on restart, which is the safe default.
  const generated = randomBytes(32).toString("hex");
  console.warn(
    "[config] SESSION_SECRET is not set -- generated an ephemeral one for this run. " +
      "Existing sessions will be invalidated on restart."
  );
  return generated;
}

export const config = {
  env: str("NODE_ENV", "development"),
  isProduction,
  port: int("PORT", 8787),
  appUrl: appUrlValue,

  databasePath: str("DATABASE_PATH", "./data/app.db"),

  /**
   * Optional egress proxy for third-party APIs. Required when the server itself
   * cannot reach Google (mainland China, locked-down VPCs, ...).
   */
  outboundProxyUrl: str("OUTBOUND_PROXY_URL"),

  session: {
    secret: resolveSessionSecret(),
    ttlDays: int("SESSION_TTL_DAYS", 30),
    cookieName: "sk_session",
    secureCookie: bool("COOKIE_SECURE", isProduction),
  },

  google: {
    clientId: str("GOOGLE_CLIENT_ID"),
    clientSecret: str("GOOGLE_CLIENT_SECRET"),
    redirectUri: str("GOOGLE_REDIRECT_URI", defaultRedirectUri()),
    // Overridable so `npm run test:google` can point the flow at a stub issuer.
    // Leave unset in real deployments.
    authEndpoint: str("GOOGLE_AUTH_ENDPOINT", "https://accounts.google.com/o/oauth2/v2/auth"),
    tokenEndpoint: str("GOOGLE_TOKEN_ENDPOINT", "https://oauth2.googleapis.com/token"),
    userinfoEndpoint: str(
      "GOOGLE_USERINFO_ENDPOINT",
      "https://openidconnect.googleapis.com/v1/userinfo"
    ),
    get configured(): boolean {
      return Boolean(config.google.clientId && config.google.clientSecret);
    },
  },

  pancake: {
    merchantId: str("WAFFO_MERCHANT_ID"),
    privateKey: resolvePrivateKey(),
    storeId: str("WAFFO_STORE_ID"),
    environment: (str("WAFFO_ENVIRONMENT", "test") === "prod" ? "prod" : "test") as "test" | "prod",
    baseUrl: str("WAFFO_BASE_URL") || undefined,
    get configured(): boolean {
      return Boolean(config.pancake.merchantId && config.pancake.privateKey);
    },
  },

  billing: {
    currency: str("DEFAULT_CURRENCY", "USD").toUpperCase(),
    successUrl: str("CHECKOUT_SUCCESS_URL", "http://localhost:8787/?billing=success"),
    pastDueGraceDays: int("PAST_DUE_GRACE_DAYS", 7),
  },
};

export type Config = typeof config;

/** Print a startup summary that never leaks secret material. */
export function describeConfig(): string[] {
  const lines = [
    `env                 ${config.env}`,
    `listen              http://localhost:${config.port}`,
    `database            ${config.databasePath}`,
    `google oauth        ${config.google.configured ? "configured" : "MISSING (email login only)"}`,
    `google redirect     ${config.google.redirectUri}`,
    `pancake merchant    ${config.pancake.merchantId ? mask(config.pancake.merchantId) : "MISSING"}`,
    `pancake private key ${config.pancake.privateKey ? "present" : "MISSING (checkout disabled)"}`,
    `pancake store       ${config.pancake.storeId ? mask(config.pancake.storeId) : "not set (run npm run pancake:setup)"}`,
    `pancake environment ${config.pancake.environment}`,
  ];
  return lines;
}

function mask(value: string): string {
  if (value.length <= 10) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
