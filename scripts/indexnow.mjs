#!/usr/bin/env node
/**
 * Submit every URL in the live sitemap to IndexNow.
 * IndexNow feeds Bing, Yandex, Seznam and Naver; no account or API key needed,
 * only the key file hosted at https://<host>/<key>.txt.
 */

const HOST = process.env.INDEXNOW_HOST || "skillskr.tech";
const KEY = process.env.INDEXNOW_KEY || "1f214122bc9ca240968d2e4b63595fb8";
const ENDPOINT = "https://api.indexnow.org/indexnow";
const BATCH = 500;

const sitemapUrl = `https://${HOST}/sitemap.xml`;
const xml = await fetch(sitemapUrl).then((r) => {
  if (!r.ok) throw new Error(`sitemap ${r.status}`);
  return r.text();
});

const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
if (!urls.length) throw new Error("no URLs found in sitemap");

console.log(`sitemap: ${urls.length} URLs`);

let ok = 0;
for (let i = 0; i < urls.length; i += BATCH) {
  const urlList = urls.slice(i, i + BATCH);
  const body = {
    host: HOST,
    key: KEY,
    keyLocation: `https://${HOST}/${KEY}.txt`,
    urlList,
  };
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  console.log(`batch ${i / BATCH + 1}: ${res.status} ${text.slice(0, 120)}`);
  if (!res.ok && res.status !== 202) {
    throw new Error(`IndexNow rejected batch with ${res.status}`);
  }
  ok += urlList.length;
}

console.log(`submitted: ${ok}`);
