import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { anonymous, genericOAuth, magicLink, oneTap } from "better-auth/plugins";
import { env } from "cloudflare:workers";
import type { AuthProvider, AuthState } from "@/lib/use-auth";
import type { MailEnv } from "@/lib/mail.server";
import type { Upload } from "@/db/schema";
import type { Role } from "@/lib/plans";
import { captureServer } from "@/lib/posthog.server"
const recordSignupGeography = async (..._args: unknown[]) => {};
import { APP_NAME } from "@/lib/brand";
import { HOSTED_EDITION } from "@/lib/edition";
import { withMailer } from "@/lib/mail.server";
import { EMAIL_POSTAL, emailButton } from "@/lib/email-layout";
import { isOAuthResourcePath, userForOAuthToken } from "@/lib/oauth.server";
import { authEmailAllowed } from "@/lib/rate-limit.server";
import { currentRegion } from "@/lib/region.server";
import { sessionCookiePrefix } from "@/lib/region";

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
  /** Set when the request came with an API key or an OAuth token: the credential acts only inside this workspace. */
  workspaceId?: string;
  /**
   * What proved who this is. Only a browser session ("session") may change identity, billing, credentials or workspace
   * security; API keys and OAuth tokens are delegated credentials and stop at those routes (see `sessionOnly`).
   */
  credential: "session" | "api_key" | "oauth";
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

/** The mailer sign-in emails go through (SES when configured). */
export function authMailer(): MailEnv {
  return withMailer<MailEnv>({
    DB: env.DB,
    SES_ACCESS_KEY_ID: optionalEnv("SES_ACCESS_KEY_ID"),
    SES_SECRET_ACCESS_KEY: optionalEnv("SES_SECRET_ACCESS_KEY"),
    SES_REGION: optionalEnv("SES_REGION") || undefined,
    EMAIL_FROM: optionalEnv("EMAIL_FROM") || undefined,
  });
}

export const isLocalOrigin = (origin: string) => isLocal(origin);

// One instance per request, never shared: a Worker never resolves a promise left pending by a cancelled request, so
// no lazily started promise inside better-auth may outlive the request that started it. Building one is cheap.
const authByRequest = new WeakMap<Request, ReturnType<typeof buildAuth>>();

function unsupportedPlaybackDatabaseOperation(): never {
  throw new Error("This operation is not supported in a playback database session");
}

function buildAuth(
  origin: string, joinSession: boolean, suppressSessionLogs: boolean, session?: D1DatabaseSession, signupRequest?: Request,
) {
  const secret = optionalEnv("BETTER_AUTH_SECRET");
  if (!secret && !isLocal(origin)) {
    throw new Error("BETTER_AUTH_SECRET is not set");
  }
  const mail = authMailer();
  const google =
    optionalEnv("GOOGLE_CLIENT_ID") && optionalEnv("GOOGLE_CLIENT_SECRET")
      ? {
          google: {
            clientId: optionalEnv("GOOGLE_CLIENT_ID"),
            clientSecret: optionalEnv("GOOGLE_CLIENT_SECRET"),
            prompt: "select_account" as const,
            mapProfileToUser: async (profile: { email?: string; email_verified?: boolean }) => {
              await adoptUnusedAccount(profile.email, profile.email_verified === true);
              return {};
            },
          },
        }
      : undefined;

  return betterAuth({
    appName: APP_NAME,
    baseURL: origin,
    basePath: "/api/auth",
    secret: secret || "local-dev-secret-not-for-production-use",
    // Better Auth's D1 adapter detects prepare, batch and exec. Its session queries
    // use prepare. A future raw command must never bypass this request's session.
    database: session ? {
      prepare: session.prepare.bind(session),
      batch: session.batch.bind(session),
      exec: unsupportedPlaybackDatabaseOperation,
      dump: unsupportedPlaybackDatabaseOperation,
      withSession: unsupportedPlaybackDatabaseOperation,
    } : env.DB,
    // The caller reports playback failures without logging SQL arguments such as session tokens.
    ...(suppressSessionLogs ? { logger: { disabled: true } } : {}),
    // Better Auth otherwise checks the database schema at runtime (a query per table, about 0.6 s on D1) and keeps
    // that check's promise. A Worker never resolves a promise whose request was cancelled, so one cancelled first
    // request left every later sign-in check in the isolate hanging. Migrations in drizzle/ own the schema.
    // The EU stack names its session cookie differently, so a cookie from one stack is never read as the other's.
    advanced: {
      database: { validateSchema: false, joins: joinSession },
      cookiePrefix: sessionCookiePrefix(currentRegion()),
    },
    trustedOrigins: [origin],
    session: { expiresIn: 60 * 60 * 24 * 365, updateAge: 60 * 60 * 24 * 7 },
    socialProviders: google ?? {},
    // Passwords serve operator-provisioned reviewer accounts and the verified owner's admin login.
    // Public password sign-up stays disabled; /admin-password lets the verified owner set an initial password.
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
    databaseHooks: {
      // Product analytics for signed-in accounts (first-party). Ids only; no email, name or other personal text is sent.
      user: {
        create: {
          after: async (created) => {
            await recordSignupGeography(env.DB, created.id, signupRequest, currentRegion());
            const guest = Boolean((created as { isAnonymous?: boolean | null }).isAnonymous)
            if (!guest) captureServer("account_saved", created.id, { method: "email_or_oauth" })
            captureServer("user_signed_up", created.id, { is_guest: guest }, { setOnce: { signed_up_on: new Date().toISOString().slice(0, 10), signup_is_guest: guest } })
          },
        },
      },
      account: {
        create: {
          after: async (linked) => {
            captureServer("account_connected", linked.userId, { provider: linked.providerId })
          },
        },
      },
      session: {
        create: {
          after: async (started) => {
            captureServer("user_signed_in", started.userId)
          },
        },
      },
    },
    plugins: [
      // A passkey needs an account to live on, so passkey sign-up starts anonymous.
      anonymous({
        emailDomainName: "passkey.invalid",
        // Signing in with Google or an email link while a guest: the guest's videos and workspaces move to that account.
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          await moveAccountData(anonymousUser.user.id, newUser.user.id);
          // Imported when needed: referrals.server reaches back into this module through access.server, and a static import changes the load order.
          const referrals = await import("@/lib/referrals.server");
          await referrals.moveReferral(anonymousUser.user.id, newUser.user.id);
          try {
            // Saving the account is what starts the 14-day trial (a guest's trial never runs).
            await (await import("@/lib/workspace.server")).startTrialFor(newUser.user.id)
          } catch { /* The trial must not fail account linking. */ }
          let ready: boolean | null = null
          try {
            ready = Boolean(await env.DB.prepare("SELECT 1 FROM uploads WHERE owner_id=? AND media_type='video' AND status='ready' AND deleted_at IS NULL LIMIT 1").bind(newUser.user.id).first())
          } catch { /* Optional reporting must not fail account linking. */ }
          captureServer("guest_account_linked", newUser.user.id, ready === null ? {} : { has_ready_video: ready })
          // A guest who recorded before saving the account has already done the thing a referral waits for.
          if (ready) await referrals.settleReferral(newUser.user.id)
        },
      }),
      magicLink({
        expiresIn: 60 * 15,
        sendMagicLink: async ({ email, url }, ctx) => {
          // Counted before anything is sent and whether or not the address has an account, so a refusal says nothing about it.
          const sending = await authEmailAllowed(ctx?.request?.headers ?? ctx?.headers, email);
          if (!sending.ok) {
            throw new APIError("TOO_MANY_REQUESTS", { message: "Too many sign-in emails. Try again later.", code: "TOO_MANY_EMAILS" }, { "retry-after": String(sending.retryAfter) });
          }
          if (mail.EMAIL && mail.EMAIL_FROM) {
            await mail.EMAIL.send({
              audit: { stream: "transactional", template: "sign-in-link" },
              to: email,
              from: mail.EMAIL_FROM,
              subject: "Your sign-in link 🔑",
              text: `Sign in to ${APP_NAME}:\n\n${url}\n\nThe link works once and expires in 15 minutes. If you didn't ask for it, ignore this email.\n\n${EMAIL_POSTAL}`,
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
                  mapProfileToUser: async (profile: Record<string, unknown>) => {
                    await adoptUnusedAccount(typeof profile.email === "string" ? profile.email : undefined, profile.email_verified === true || profile.emailVerified === true);
                    return {};
                  },
                },
              ],
            }),
          ]
        : []),
    ],
  });
}

/**
 * An account a workspace created ahead of time for someone (from its identity provider) starts with its email unproven.
 * Better Auth links Google or company sign-in only to a proven address, so when the provider vouches for the address and
 * nobody has ever signed into the account (no linked login, session or passkey), the address counts as proven, as an
 * email link would make it. An account anyone has used is left alone.
 */
export async function adoptUnusedAccount(email: string | undefined, providerVerified: boolean): Promise<void> {
  if (!email || !providerVerified) return;
  await env.DB.prepare(
    `UPDATE "user" SET "emailVerified" = 1, "updatedAt" = ? WHERE lower(email) = ? AND coalesce("emailVerified", 0) = 0 AND coalesce("isAnonymous", 0) = 0
       AND NOT EXISTS (SELECT 1 FROM account WHERE "userId" = "user".id)
       AND NOT EXISTS (SELECT 1 FROM session WHERE "userId" = "user".id)
       AND NOT EXISTS (SELECT 1 FROM passkey WHERE "userId" = "user".id)`,
  )
    .bind(new Date().toISOString(), email.trim().toLowerCase())
    .run();
}

export function getAuth(request: Request, suppressSessionLogs = false, session?: D1DatabaseSession) {
  let auth = session ? undefined : authByRequest.get(request);
  if (!auth) {
    const url = new URL(request.url);
    // Fetch the session and user together for hot uploads, with a fresh DB read on every request.
    const joinUploadSession = HOSTED_EDITION && request.method === "PUT"
      && /^\/api\/recordings\/[^/]+\/(live|parts)$/.test(url.pathname);
    const joinViewerSession = HOSTED_EDITION && optionalEnv("JOIN_VIEWER_SESSION") === "1"
      && request.method === "GET" && /^(?:\/api\/media)?\/[a-f0-9]{8}$/.test(url.pathname);
    auth = buildAuth(url.origin, joinUploadSession || joinViewerSession, suppressSessionLogs, session, request);
    if (!session) authByRequest.set(request, auth);
  }
  return auth;
}

export async function getSessionUser(
  request: Request,
  options?: { throwBackendErrors?: boolean; suppressSessionLogs?: boolean; databaseSession?: D1DatabaseSession },
): Promise<SessionUser | null> {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer rk_")) return userForApiKey(authorization.slice(7).trim());
  if (authorization?.startsWith("Bearer vat_")) {
    // An OAuth token is issued for the MCP resource only. Anywhere else it is not a credential, and it never falls through to a cookie.
    const url = new URL(request.url);
    if (!isOAuthResourcePath(url.pathname)) return null;
    return userForOAuthToken(authorization.slice(7).trim(), url.origin);
  }
  try {
    const session = await getAuth(request, options?.suppressSessionLogs, options?.databaseSession).api.getSession({
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
      credential: "session",
    };
  } catch (error) {
    // A recording can retry a backend failure while still rejecting invalid credentials.
    if (options?.throwBackendErrors && (typeof error !== "object" || error === null
      || !("statusCode" in error) || (typeof error.statusCode === "number" && error.statusCode >= 500))) throw error;
    return null;
  }
}

/** The browser session behind a request's cookie (never a bearer credential), for callers that must tell one session from another. */
export async function getCookieSession(request: Request): Promise<{ userId: string; sessionId: string } | null> {
  try {
    const session = await getAuth(request).api.getSession({ headers: request.headers });
    return session ? { userId: session.user.id, sessionId: session.session.id } : null;
  } catch {
    return null;
  }
}

const API_KEY_TOUCH_MS = 60 * 60 * 1000;

type UploadWriteKind = "live" | "parts";

type ApiKeyIdentity = {
  id: string;
  workspaceId: string;
  lastUsedAt: string | null;
  userId: string;
  name: string;
  email: string;
  image: string | null;
  anon: number | null;
  role?: Role;
  uploadId: string | null;
  uploadStatus: Upload["status"] | null;
  uploadOwnerId: string | null;
  r2Key?: string | null;
  multipartUploadId?: string | null;
  cameraKey?: string | null;
  cameraMultipartUploadId?: string | null;
};

async function hashApiKey(token: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function touchApiKey(id: string, lastUsedAt: string | null): Promise<void> {
  if (!lastUsedAt || Date.now() - Date.parse(lastUsedAt) > API_KEY_TOUCH_MS) {
    await env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
  }
}

async function loadApiKeyIdentity(token: string, target?: { id: string; kind: UploadWriteKind }): Promise<ApiKeyIdentity | null> {
  if (!/^rk_[a-f0-9]{40}$/.test(token)) return null;
  const hash = await hashApiKey(token);
  const membership = "m.workspace_id = k.workspace_id AND m.user_id = k.user_id";
  // Keep the authenticated key row when the upload is absent or belongs to another workspace.
  // This preserves the distinction between an invalid credential and an inaccessible upload.
  const row = await env.DB.prepare(
    `SELECT k.id, k.workspace_id AS workspaceId, k.last_used_at AS lastUsedAt, u.id AS userId, u.name, u.email, u.image, u."isAnonymous" AS anon
       ${target ? ", m.role, r.id AS uploadId, r.status AS uploadStatus, r.owner_id AS uploadOwnerId" : ""}
       ${target?.kind === "parts" ? `, r.r2_key AS r2Key, r.multipart_upload_id AS multipartUploadId,
         r.camera_key AS cameraKey, r.camera_multipart_upload_id AS cameraMultipartUploadId` : ""}
     FROM api_keys k JOIN "user" u ON u.id = k.user_id
     ${target ? `JOIN workspace_members m ON ${membership}
       LEFT JOIN uploads r ON r.id = ?2 AND r.workspace_id = k.workspace_id` : ""}
     WHERE k.token_hash = ?1 AND k.revoked_at IS NULL
       ${target ? "" : `AND EXISTS (SELECT 1 FROM workspace_members m WHERE ${membership})`}`,
  ).bind(...(target ? [hash, target.id] : [hash])).first<ApiKeyIdentity>();
  if (!row) return null;
  await touchApiKey(row.id, row.lastUsedAt);
  return row;
}

export function joinedUploadKey(request: Request, kind: UploadWriteKind): string | null {
  const flag = kind === "live" ? "LIVE_UPLOAD_KEY_JOIN" : "PART_UPLOAD_KEY_JOIN";
  const authorization = request.headers.get("authorization");
  return HOSTED_EDITION && optionalEnv(flag) === "1" && authorization?.startsWith("Bearer rk_")
    ? authorization.slice(7).trim()
    : null;
}

type UploadKeyIdentity = Pick<ApiKeyIdentity, "userId" | "workspaceId" | "role" | "uploadId" | "uploadStatus" |
  "uploadOwnerId" | "r2Key" | "multipartUploadId" | "cameraKey" | "cameraMultipartUploadId">;

export async function apiKeyUploadIdentity(token: string, id: string, kind: UploadWriteKind): Promise<UploadKeyIdentity | null> {
  return loadApiKeyIdentity(token, { id, kind });
}

/** The user behind an API key (agents, scripts, MCP clients), scoped to the key's workspace. */
async function userForApiKey(token: string): Promise<SessionUser | null> {
  const row = await loadApiKeyIdentity(token);
  if (!row) return null;
  const name = row.name.trim() || (row.anon ? "Passkey user" : row.email.split("@")[0]);
  return {
    sub: row.userId,
    name,
    avatar: row.image || `https://api.dicebear.com/10.x/initials/svg?seed=${encodeURIComponent(name)}`,
    email: row.anon ? null : row.email,
    workspaceId: row.workspaceId,
    credential: "api_key",
  };
}

/** A share render can reuse one identity lookup inside this request. */
export function shareSessionReader(request: Request): () => Promise<SessionUser | null> {
  const read = () => getSessionUser(request);
  if (!HOSTED_EDITION || Reflect.get(env, "SHARE_REQUEST_IDENTITY") !== "1") return read;
  let identity: Promise<SessionUser | null> | undefined;
  return () => identity ??= read();
}

/**
 * Full auth state for a request, resolved server-side so the share page
 * renders with the right comments/likes UI on the very first paint.
 */
export async function getAuthState(request: Request, readUser = () => getSessionUser(request)): Promise<AuthState> {
  const sessionUser = await readUser();
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

export { safeRedirectPath } from "@/lib/safe-redirect";

const magicLinkHtml = (url: string) => `<h1 style="margin:0 0 12px;font-size:26px;line-height:1.2;letter-spacing:-.7px">Sign in to ${APP_NAME}</h1>
<p style="margin:0 0 20px">The button works once and expires in 15 minutes.</p>
${emailButton(url, "Sign in to Vertov")}
<p style="margin:16px 0 0;font-size:13px;color:#585b60">Didn't ask for this? You can ignore it.</p>`;

/**
 * Statements that end every bearer credential a user holds: API keys are revoked, OAuth tokens and pending codes and
 * webhook endpoints (with their delivery log) are deleted. Credentials are never handed to another account.
 */
export function revokeCredentialStatements(userId: string, now = new Date().toISOString()): Array<D1PreparedStatement> {
  return [
    env.DB.prepare("UPDATE api_keys SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now, userId),
    env.DB.prepare("DELETE FROM oauth_tokens WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM oauth_codes WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM webhook_deliveries WHERE endpoint_id IN (SELECT id FROM webhook_endpoints WHERE created_by = ?)").bind(userId),
    env.DB.prepare("DELETE FROM webhook_endpoints WHERE created_by = ?").bind(userId),
  ]
}

/**
 * Hands everything a guest account owns to the account they signed in with: videos, folders, workspaces and their data.
 * The guest's API keys, OAuth tokens and webhook endpoints are revoked instead, so no credential minted before the merge
 * keeps working as the receiving account.
 */
export async function moveAccountData(fromId: string, toId: string): Promise<void> {
  if (fromId === toId) return;
  // Only a person's first workspace has free hours: a guest workspace moving onto an account that already owns one has none.
  const alreadyOwns = await env.DB.prepare("SELECT 1 AS owns FROM workspace_members WHERE user_id = ? AND role = 'owner' LIMIT 1").bind(toId).first();
  await env.DB.batch([
    ...(alreadyOwns ? [env.DB.prepare("UPDATE workspaces SET free_bank = 0 WHERE created_by = ? AND plan = 'free'").bind(fromId)] : []),
    env.DB.prepare("UPDATE uploads SET owner_id = ? WHERE owner_id = ?").bind(toId, fromId),
    env.DB.prepare("UPDATE folders SET owner_id = ? WHERE owner_id = ?").bind(toId, fromId),
    env.DB.prepare("UPDATE OR IGNORE workspace_members SET user_id = ? WHERE user_id = ?").bind(toId, fromId),
    env.DB.prepare("DELETE FROM workspace_members WHERE user_id = ?").bind(fromId),
    env.DB.prepare("UPDATE workspaces SET created_by = ? WHERE created_by = ?").bind(toId, fromId),
    env.DB.prepare("UPDATE spaces SET created_by = ? WHERE created_by = ?").bind(toId, fromId),
    env.DB.prepare("UPDATE workspace_invites SET created_by = ? WHERE created_by = ?").bind(toId, fromId),
    env.DB.prepare("UPDATE video_requests SET created_by = ? WHERE created_by = ?").bind(toId, fromId),
    env.DB.prepare("UPDATE playlists SET owner_id = ? WHERE owner_id = ?").bind(toId, fromId),
    env.DB.prepare("UPDATE tutorial_jobs SET created_by = ? WHERE created_by = ?").bind(toId, fromId),
    env.DB.prepare("UPDATE audit_log SET actor_id = ? WHERE actor_id = ?").bind(toId, fromId),
    env.DB.prepare("UPDATE OR IGNORE watch_later SET user_id = ? WHERE user_id = ?").bind(toId, fromId),
    ...revokeCredentialStatements(fromId),
  ]);
}
