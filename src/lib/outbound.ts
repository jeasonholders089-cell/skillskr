import { ProxyAgent, fetch as undiciFetch } from "undici";
import { config } from "../config.ts";

let proxyAgent: ProxyAgent | null = null;
let warned = false;

/**
 * Outbound HTTP for third-party APIs (Google, Waffo Pancake).
 *
 * Node's built-in `fetch` ignores HTTPS_PROXY, so when `OUTBOUND_PROXY_URL` is
 * set we route through undici's ProxyAgent instead. That matters for deployments
 * that cannot reach Google directly (e.g. mainland China): the OAuth token
 * exchange happens server-side, so the *server* needs a working route to Google,
 * not just the browser.
 *
 * When no proxy is configured this is exactly the global fetch.
 */
export const outboundFetch: typeof fetch = (input, init) => {
  if (!config.outboundProxyUrl) {
    return fetch(input as never, init as never) as never;
  }
  if (!proxyAgent) {
    proxyAgent = new ProxyAgent(config.outboundProxyUrl);
  }
  return undiciFetch(input as never, { ...(init as object), dispatcher: proxyAgent } as never) as never;
};

/** One-line description of the egress path, for the startup banner. */
export function describeOutbound(): string {
  if (!config.outboundProxyUrl) {
    if (!warned) warned = true;
    return "direct (no proxy)";
  }
  return `via proxy ${maskUrl(config.outboundProxyUrl)}`;
}

function maskUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.password) url.password = "***";
    if (url.username) url.username = "***";
    return url.toString();
  } catch {
    return "(invalid URL)";
  }
}
