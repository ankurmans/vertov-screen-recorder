import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { anonymous, genericOAuth, magicLink, oneTap } from "better-auth/plugins";
import { env } from "cloudflare:workers";
import type { AuthProvider, AuthState } from "@/lib/use-auth";
import type { MailEnv } from "@/lib/mail.server";
import { APP_NAME } from "@/lib/brand";
import { withMailer } from "@/lib/mail.server";

/**
 * Accounts via Better Auth on D1: passkeys (no setup needed), email magic
 * links through SES, and Google when its OAuth client is configured. The
 * same session is used for owning recordings and for commenting/liking on
 * share pages.
 */

export interface SessionUser {
  /** Better Auth user id — stored as comments.viewer_id and uploads.owner_id. */
  sub: string;
  name: string;
  avatar: string;
  email: string | null;
  /** Set when the request came with an API key: the key acts only inside this workspace. */
  workspaceId?: string;
}

function optionalEnv(name: string): string {
  const value = Reflect.get(env, name);
  return typeof value === "string" ? value : "";
}

const isLocal = (origin: string) =>
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

/** The public Google client id, for One Tap on the landing page; empty until Google sign-in is configured. */
export function googleClientId(): string {
  return optionalEnv("GOOGLE_CLIENT_ID") && optionalEnv("GOOGLE_CLIENT_SECRET") ? optionalEnv("GOOGLE_CLIENT_ID") : "";
}

/** Label for the company single sign-on button; null until an OIDC provider is fully configured. */
export function ssoName(): string | null {
  if (!optionalEnv("SSO_OIDC_ISSUER") || !optionalEnv("SSO_OIDC_CLIENT_ID") || !optionalEnv("SSO_OIDC_CLIENT_SECRET")) return null;
  return optionalEnv("SSO_OIDC_NAME") || "SSO";
}

export function enabledProviders(origin: string): Array<AuthProvider> {
  const providers: Array<AuthProvider> = ["passkey"];
  if (optionalEnv("SES_ACCESS_KEY_ID") || isLocal(origin)) providers.push("email");
  if (optionalEnv("GOOGLE_CLIENT_ID") && optionalEnv("GOOGLE_CLIENT_SECRET"))
    providers.push("google");
  if (ssoName()) providers.push("sso");
  return providers;
}

const authByOrigin = new Map<string, ReturnType<typeof buildAuth>>();

function buildAuth(origin: string) {
  const secret = optionalEnv("BETTER_AUTH_SECRET");
  if (!secret && !isLocal(origin)) {
    throw new Error("BETTER_AUTH_SECRET is not set");
  }
  const mail = withMailer<MailEnv>({
    SES_ACCESS_KEY_ID: optionalEnv("SES_ACCESS_KEY_ID"),
    SES_SECRET_ACCESS_KEY: optionalEnv("SES_SECRET_ACCESS_KEY"),
    SES_REGION: optionalEnv("SES_REGION") || undefined,
    EMAIL_FROM: optionalEnv("EMAIL_FROM") || undefined,
  });
  const google =
    optionalEnv("GOOGLE_CLIENT_ID") && optionalEnv("GOOGLE_CLIENT_SECRET")
      ? {
          google: {
            clientId: optionalEnv("GOOGLE_CLIENT_ID"),
            clientSecret: optionalEnv("GOOGLE_CLIENT_SECRET"),
            prompt: "select_account" as const,
          },
        }
      : undefined;

  return betterAuth({
    appName: APP_NAME,
    baseURL: origin,
    basePath: "/api/auth",
    secret: secret || "local-dev-secret-not-for-production-use",
    database: env.DB,
    trustedOrigins: [origin],
    session: { expiresIn: 60 * 60 * 24 * 365, updateAge: 60 * 60 * 24 * 7 },
    socialProviders: google ?? {},
    plugins: [
      // A passkey needs an account to live on, so passkey sign-up starts anonymous.
      anonymous({
        emailDomainName: "passkey.invalid",
        // Signing in with Google or an email link while a guest: the guest's videos and workspaces move to that account.
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          await moveAccountData(anonymousUser.user.id, newUser.user.id);
        },
      }),
      magicLink({
        expiresIn: 60 * 15,
        sendMagicLink: async ({ email, url }) => {
          if (mail.EMAIL && mail.EMAIL_FROM) {
            await mail.EMAIL.send({
              to: email,
              from: mail.EMAIL_FROM,
              subject: `Your ${APP_NAME} sign-in link`,
              text: `Sign in to ${APP_NAME}:\n\n${url}\n\nThe link works once and expires in 15 minutes. If you didn't ask for it, ignore this email.`,
              html: magicLinkHtml(url),
            });
          } else if (isLocal(origin)) {
            console.log(`\n[magic link for ${email}] ${url}\n`);
          } else {
            throw new Error("Email sign-in isn't set up yet.");
          }
        },
      }),
      passkey({ rpID: new URL(origin).hostname, rpName: APP_NAME, origin }),
      // Lets the Google prompt on the landing page sign visitors straight in.
      ...(google ? [oneTap()] : []),
      ...(ssoName()
        ? [
            genericOAuth({
              config: [
                {
                  providerId: "sso",
                  discoveryUrl: `${optionalEnv("SSO_OIDC_ISSUER").replace(/\/+$/, "")}/.well-known/openid-configuration`,
                  clientId: optionalEnv("SSO_OIDC_CLIENT_ID"),
                  clientSecret: optionalEnv("SSO_OIDC_CLIENT_SECRET"),
                  scopes: ["openid", "email", "profile"],
                  pkce: true,
                },
              ],
            }),
          ]
        : []),
    ],
  });
}

export function getAuth(request: Request) {
  const origin = new URL(request.url).origin;
  let auth = authByOrigin.get(origin);
  if (!auth) {
    auth = buildAuth(origin);
    authByOrigin.set(origin, auth);
  }
  return auth;
}

export async function getSessionUser(
  request: Request,
): Promise<SessionUser | null> {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer rk_")) return userForApiKey(authorization.slice(7).trim());
  try {
    const session = await getAuth(request).api.getSession({
      headers: request.headers,
    });
    if (!session) return null;
    const { user } = session;
    const isAnon = Boolean((user as { isAnonymous?: boolean }).isAnonymous);
    return {
      sub: user.id,
      name: user.name || (isAnon ? "Passkey user" : user.email),
      avatar:
        user.image ||
        `https://api.dicebear.com/10.x/initials/svg?seed=${encodeURIComponent(user.name || user.id)}`,
      email: isAnon ? null : user.email,
    };
  } catch {
    return null;
  }
}

const API_KEY_TOUCH_MS = 60 * 60 * 1000;

/** The user behind an API key (agents, scripts, MCP clients), scoped to the key's workspace. */
async function userForApiKey(token: string): Promise<SessionUser | null> {
  if (!/^rk_[a-f0-9]{40}$/.test(token)) return null;
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const row = await env.DB.prepare(
    `SELECT k.id, k.workspace_id AS workspaceId, k.last_used_at AS lastUsedAt, u.id AS userId, u.name, u.email, u.image, u."isAnonymous" AS anon
     FROM api_keys k JOIN "user" u ON u.id = k.user_id
     WHERE k.token_hash = ? AND k.revoked_at IS NULL
       AND EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = k.workspace_id AND m.user_id = k.user_id)`,
  )
    .bind(hash)
    .first<{ id: string; workspaceId: string; lastUsedAt: string | null; userId: string; name: string; email: string; image: string | null; anon: number | null }>();
  if (!row) return null;
  if (!row.lastUsedAt || Date.now() - Date.parse(row.lastUsedAt) > API_KEY_TOUCH_MS) {
    await env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").bind(new Date().toISOString(), row.id).run();
  }
  const name = row.name.trim() || (row.anon ? "Passkey user" : row.email.split("@")[0]);
  return {
    sub: row.userId,
    name,
    avatar: row.image || `https://api.dicebear.com/10.x/initials/svg?seed=${encodeURIComponent(name)}`,
    email: row.anon ? null : row.email,
    workspaceId: row.workspaceId,
  };
}

/**
 * Full auth state for a request, resolved server-side so the share page
 * renders with the right comments/likes UI on the very first paint.
 */
export async function getAuthState(request: Request): Promise<AuthState> {
  const sessionUser = await getSessionUser(request);
  return {
    authEnabled: true,
    providers: enabledProviders(new URL(request.url).origin),
    user: sessionUser
      ? {
          id: sessionUser.sub,
          name: sessionUser.name,
          avatar: sessionUser.avatar,
        }
      : null,
  };
}

/** Only same-site paths, so redirects can't be used to leave the site. */
export function safeRedirectPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/home";
  return raw;
}

const magicLinkHtml = (url: string) => `<!doctype html><html><body style="margin:0;background:#f5f5f5;font-family:system-ui,sans-serif;color:#171717">
<div style="max-width:440px;margin:40px auto;background:#fff;border:1px solid #e5e5e5;border-radius:16px;padding:28px">
<h1 style="margin:0 0 8px;font-size:22px">Sign in to ${APP_NAME}</h1>
<p style="margin:0 0 22px;font-size:15px;line-height:1.5;color:#525252">The button works once and expires in 15 minutes.</p>
<a href="${url}" style="display:inline-block;background:#4f46e5;color:#fff;border-radius:10px;padding:12px 20px;font-weight:600;font-size:15px;text-decoration:none">Sign in</a>
<p style="margin:22px 0 0;font-size:13px;color:#737373">Didn't ask for this? You can ignore it.</p>
</div></body></html>`;

/** Hands everything a guest account owns to the account they signed in with. */
export async function moveAccountData(fromId: string, toId: string): Promise<void> {
  if (fromId === toId) return;
  await env.DB.batch([
    env.DB.prepare("UPDATE uploads SET owner_id = ? WHERE owner_id = ?").bind(toId, fromId),
    env.DB.prepare("UPDATE folders SET owner_id = ? WHERE owner_id = ?").bind(toId, fromId),
    env.DB.prepare("UPDATE OR IGNORE workspace_members SET user_id = ? WHERE user_id = ?").bind(toId, fromId),
    env.DB.prepare("DELETE FROM workspace_members WHERE user_id = ?").bind(fromId),
    env.DB.prepare("UPDATE workspaces SET created_by = ? WHERE created_by = ?").bind(toId, fromId),
    env.DB.prepare("UPDATE spaces SET created_by = ? WHERE created_by = ?").bind(toId, fromId),
    env.DB.prepare("UPDATE workspace_invites SET created_by = ? WHERE created_by = ?").bind(toId, fromId),
    env.DB.prepare("UPDATE video_requests SET created_by = ? WHERE created_by = ?").bind(toId, fromId),
    env.DB.prepare("UPDATE api_keys SET user_id = ? WHERE user_id = ?").bind(toId, fromId),
  ]);
}
