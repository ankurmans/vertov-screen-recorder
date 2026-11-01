import { APP_NAME } from "@/lib/brand";
// Outgoing email through AWS SES (the v2 API, signed with SigV4 using Web Crypto, so no SDK is needed in a Worker).
// Everything that sends mail (invites, sign-in links, mention fallbacks) talks to env.EMAIL, so this just provides one.
// Nothing sends until SES_ACCESS_KEY_ID and SES_SECRET_ACCESS_KEY are set; a Cloudflare send_email binding still wins.

export interface Mailer {
  send: (message: { to: string; from: string; subject: string; html: string; text: string }) => Promise<unknown>;
}

export interface MailEnv {
  EMAIL?: Mailer;
  EMAIL_FROM?: string;
  SES_ACCESS_KEY_ID?: string;
  SES_SECRET_ACCESS_KEY?: string;
  /** Defaults to us-east-1. */
  SES_REGION?: string;
}

const DEFAULT_FROM = `${APP_NAME} <noreply@example.com>`;
const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256Hex = async (data: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(data)));

async function hmac(key: ArrayBuffer | string, data: string): Promise<ArrayBuffer> {
  const raw = typeof key === "string" ? enc.encode(key) : key;
  const k = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}

/** The headers AWS wants on a JSON POST to the SES v2 API (SigV4). `now` is injectable so the signature can be checked. */
export async function signSesRequest(opts: { accessKeyId: string; secretAccessKey: string; region: string; path: string; body: string; now?: Date }) {
  const host = `email.${opts.region}.amazonaws.com`;
  const amzDate = (opts.now ?? new Date()).toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex(opts.body);
  const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-date";
  const canonicalRequest = ["POST", opts.path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${day}/${opts.region}/ses/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest)].join("\n");
  const kDate = await hmac(`AWS4${opts.secretAccessKey}`, day);
  const kRegion = await hmac(kDate, opts.region);
  const kService = await hmac(kRegion, "ses");
  const kSigning = await hmac(kService, "aws4_request");
  const signature = hex(await hmac(kSigning, stringToSign));
  return {
    host,
    headers: {
      "content-type": "application/json",
      "x-amz-date": amzDate,
      authorization: `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

const ses = (accessKeyId: string, secretAccessKey: string, region: string, endpoint?: string): Mailer => ({
  async send({ to, from, subject, html, text }) {
    const path = "/v2/email/outbound-emails";
    const body = JSON.stringify({
      FromEmailAddress: from,
      Destination: { ToAddresses: [to] },
      Content: { Simple: { Subject: { Data: subject, Charset: "UTF-8" }, Body: { Text: { Data: text, Charset: "UTF-8" }, Html: { Data: html, Charset: "UTF-8" } } } },
    });
    const { host, headers } = await signSesRequest({ accessKeyId, secretAccessKey, region, path, body });
    const res = await fetch(`${endpoint ?? `https://${host}`}${path}`, { method: "POST", headers, body });
    if (!res.ok) throw new Error(`SES ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  },
});

/** The env with env.EMAIL backed by SES when its keys are set. */
export function withMailer<TEnv extends MailEnv>(env: TEnv): TEnv {
  if (env.EMAIL || !env.SES_ACCESS_KEY_ID || !env.SES_SECRET_ACCESS_KEY) return env;
  return { ...env, EMAIL: ses(env.SES_ACCESS_KEY_ID, env.SES_SECRET_ACCESS_KEY, env.SES_REGION || "us-east-1"), EMAIL_FROM: env.EMAIL_FROM || DEFAULT_FROM };
}
