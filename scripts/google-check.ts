/**
 * Pre-flight check for the Google OAuth configuration.
 *
 *   npm run google:check
 *
 * Probes Google's token endpoint with a deliberately invalid authorization code.
 * The error it comes back with tells us exactly which piece is wrong:
 *
 *   invalid_grant          -> client id, client secret and redirect URI all accepted
 *                            (only the fake code was rejected)
 *   redirect_uri_mismatch  -> the redirect URI is not registered on that client
 *   invalid_client         -> client id or client secret is wrong
 *
 * Requires network access. Nothing is created or changed on Google's side.
 */
import { config } from "../src/config.ts";
import { formatError } from "../src/lib/errors.ts";
import { outboundFetch } from "../src/lib/outbound.ts";

const CLIENT_ID_RE = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/i;

function line(label: string, value: string): void {
  console.log(`  ${label.padEnd(18)}${value}`);
}

async function main(): Promise<void> {
  console.log("\n  Google OAuth pre-flight\n");

  line("client id", config.google.clientId || "(not set)");
  line("client secret", config.google.clientSecret ? `set (${config.google.clientSecret.length} chars)` : "(not set)");
  line("redirect uri", config.google.redirectUri);
  line("app url", config.appUrl);
  line("outbound", config.outboundProxyUrl ? `proxy ${config.outboundProxyUrl}` : "direct");
  console.log("");

  if (!config.google.configured) {
    console.log("  [x] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set in .env.");
    console.log("    Follow the steps in README section 2, then run this again.\n");
    process.exitCode = 1;
    return;
  }

  if (!CLIENT_ID_RE.test(config.google.clientId)) {
    console.log(
      "  ! The client id does not look like a Google OAuth client id.\n" +
        "    Expected something like 1234567890-abc123.apps.googleusercontent.com.\n" +
        "    If you copied an API key instead, that is the wrong credential.\n"
    );
  }

  if (!config.google.redirectUri.startsWith("http")) {
    console.log("  ! The redirect URI must be an absolute http(s) URL.\n");
    process.exitCode = 1;
    return;
  }

  console.log("  -> probing https://oauth2.googleapis.com/token with a dummy code...\n");

  const body = new URLSearchParams({
    code: "definitely-not-a-real-code",
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    redirect_uri: config.google.redirectUri,
    grant_type: "authorization_code",
  });

  let status = 0;
  let error = "";
  let description = "";
  try {
    const res = await outboundFetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    status = res.status;
    const payload = (await res.json().catch(() => ({}))) as { error?: string; error_description?: string };
    error = payload.error ?? "";
    description = payload.error_description ?? "";
  } catch (err) {
    console.log(`  [x] Could not reach Google: ${formatError(err)}`);
    console.log("");
    console.log("  Google 的 token 交换是服务端发起的，所以跑这个服务的机器必须能直连 Google。");
    console.log("  如果你在国内或受限网络里，两种办法：");
    console.log("    1) 把后端部署到能访问 Google 的机器（海外 VPS）；");
    console.log("    2) 给服务端配代理：在 .env 里设置 OUTBOUND_PROXY_URL=http://127.0.0.1:7890");
    console.log("       （Node 自带的 fetch 不认 HTTPS_PROXY，必须用这个变量）");
    console.log("");
    process.exitCode = 1;
    return;
  }

  console.log(`  <- HTTP ${status}  error=${error || "(none)"}`);
  if (description) console.log(`     ${description}`);
  console.log("");

  switch (error) {
    case "invalid_grant":
      console.log("  [ok] 凭据没问题：client id / secret / 回调地址三者配对成功，");
      console.log("    只有那个假授权码被拒绝（这正是预期结果）。");
      console.log("    现在可以直接打开 http://localhost:" + config.port + " 点「用 Google 登录」。\n");
      break;
    case "redirect_uri_mismatch":
      console.log("  [x] 回调地址没在 Google 那边登记。去 OAuth 客户端里把下面这行");
      console.log("    一字不差地加到「已获授权的重定向 URI」：\n");
      console.log(`      ${config.google.redirectUri}\n`);
      console.log("    注意：协议、端口、结尾有没有斜杠都算不同地址；改完等 1–5 分钟生效。\n");
      process.exitCode = 1;
      break;
    case "invalid_client":
      console.log("  [x] client id 或 client secret 不对。常见原因：");
      console.log("    - 复制时带了空格 / 换行，或把「客户端 ID」和「客户端密钥」弄反");
      console.log("    - 用的是已删除客户端的旧密钥");
      console.log("    - 用了 API key，而不是 OAuth 客户端的密钥\n");
      process.exitCode = 1;
      break;
    default:
      console.log("  ? 没认出这个错误码，把上面的原始响应发我。\n");
      process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(`\n  Check failed: ${formatError(err)}\n`);
  process.exitCode = 1;
});
