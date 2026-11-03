import type { MailEnv } from "./mail.server";
import { withMailer } from "./mail.server";
import { LESSONS, renderLesson } from "./lifecycle-emails";
import { emailFrame } from "./email-layout";

const DAY = 86_400_000;
export type LifecycleEnv = MailEnv & {
  DB: D1Database;
  LIFECYCLE_MODE?: string;
  LIFECYCLE_SINCE?: string;
  LIFECYCLE_ONLY?: string;
  LIFECYCLE_FROM?: string;
  LIFECYCLE_REPLY_TO?: string;
  LIFECYCLE_POSTAL?: string;
  LIFECYCLE_CONFIG_SET?: string;
};
export type Facts = {
  ready: number;
  viewed: number;
  edited: number;
  customized: number;
  imported: number;
  protected: number;
};
export function skipLesson(kind: string, f: Facts) {
  return (
    ({
      record: f.ready,
      view: f.viewed,
      edit: f.edited,
      layout: f.customized,
      import: f.imported,
      privacy: f.protected,
    }[kind] ?? 0) > 0
  );
}
export function signupTime(value: string | number) {
  if (typeof value === "number" || /^\d+$/.test(value)) return Number(value);
  return Date.parse(
    value.endsWith("Z") || /[+-]\d\d:\d\d$/.test(value)
      ? value
      : value.replace(" ", "T") + "Z",
  );
}
/** Claims are never retried automatically: a timeout may mean SES already accepted it. */
export async function lifecycleTick(env: LifecycleEnv, now = Date.now()) {
  const mode = env.LIFECYCLE_MODE ?? "off";
  const result = { considered: 0, wouldSend: 0, accepted: 0, uncertain: 0 };
  if (!["dry", "only", "on"].includes(mode)) return result;
  const since = Date.parse(env.LIFECYCLE_SINCE ?? "");
  if (!Number.isFinite(since) || since > now) return result;
  const only = new Set(
    (env.LIFECYCLE_ONLY ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  if (mode === "only" && !only.size) return result;
  if (
    mode !== "dry" &&
    (!env.LIFECYCLE_FROM ||
      !env.LIFECYCLE_REPLY_TO ||
      !env.LIFECYCLE_POSTAL ||
      !env.SES_ACCESS_KEY_ID ||
      !env.SES_SECRET_ACCESS_KEY)
  )
    return result;
  if (
    await env.DB.prepare(
      "SELECT 1 FROM lifecycle_sends WHERE status='uncertain' LIMIT 1",
    ).first()
  )
    return result;
  const people = await env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.createdAt FROM user u LEFT JOIN lifecycle_preferences p ON p.user_id=u.id
 WHERE (CASE WHEN typeof(u.createdAt) IN ('integer','real') THEN u.createdAt ELSE coalesce(unixepoch(u.createdAt)*1000,CAST(u.createdAt AS INTEGER)) END) BETWEEN ? AND ?
 AND u.email NOT LIKE '%.invalid' AND u.emailVerified=1 AND coalesce(u.isAnonymous,0)=0 AND coalesce(p.opted_out,0)=0
 ORDER BY coalesce(p.last_checked,0), u.id LIMIT 100`,
  )
    .bind(Math.max(since, now - 34 * DAY), now)
    .all<{
      id: string;
      name: string;
      email: string;
      createdAt: string | number;
    }>();
  for (const u of people.results) {
    if (mode === "only" && !only.has(u.email.toLowerCase())) continue;
    const created = signupTime(u.createdAt);
    if (
      !Number.isFinite(created) ||
      created < since ||
      created > now ||
      now - created > 34 * DAY ||
      /\.invalid$/i.test(u.email)
    )
      continue;
    result.considered++;
    if (mode !== "dry") {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO lifecycle_preferences(user_id,token) VALUES (?,?)",
      )
        .bind(u.id, crypto.randomUUID() + crypto.randomUUID())
        .run();
      await env.DB.prepare(
        "UPDATE lifecycle_preferences SET last_checked=? WHERE user_id=?",
      )
        .bind(now, u.id)
        .run();
    }
    const f = await env.DB.prepare(
      `SELECT count(*) AS ready,
   coalesce(sum(last_viewed_at IS NOT NULL),0) AS viewed,
   coalesce(sum(cuts IS NOT NULL AND cuts!='[]'),0) AS edited,
   coalesce(sum(style IS NOT NULL),0) AS customized,
   coalesce(sum(source_url IS NOT NULL),0) AS imported,
   coalesce(sum(password_hash IS NOT NULL),0) AS protected
   FROM uploads WHERE owner_id=? AND status='ready' AND media_type='video' AND deleted_at IS NULL`,
    )
      .bind(u.id)
      .first<Facts>();
    const sent = await env.DB.prepare(
      "SELECT lesson, claimed_at FROM lifecycle_sends WHERE user_id=?",
    )
      .bind(u.id)
      .all<{ lesson: string; claimed_at: number }>();
    const due = LESSONS.find(
      (l) =>
        now >= created + l.day * DAY &&
        now < created + (l.day + 3) * DAY &&
        !skipLesson(l.skip, f!) &&
        !sent.results.some((s) => s.lesson === l.id),
    );
    if (
      !due ||
      sent.results.some((s) => s.claimed_at > now - DAY) ||
      sent.results.filter((s) => s.claimed_at > now - 7 * DAY).length >= 3
    )
      continue;
    if (mode === "dry") {
      result.wouldSend++;
      continue;
    }
    await env.DB.prepare(
      "INSERT OR IGNORE INTO lifecycle_preferences(user_id,token) VALUES (?,?)",
    )
      .bind(u.id, crypto.randomUUID() + crypto.randomUUID())
      .run();
    // Atomic conditional claim also enforces the shared frequency cap across overlapping cron runs.
    const claim = await env.DB.prepare(
      `INSERT OR IGNORE INTO lifecycle_sends(user_id,lesson,claimed_at)
   SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM lifecycle_preferences WHERE user_id=? AND opted_out=0)
   AND NOT EXISTS(SELECT 1 FROM lifecycle_sends WHERE user_id=? AND claimed_at>?)
   AND (SELECT count(*) FROM lifecycle_sends WHERE user_id=? AND claimed_at>?)<3`,
    )
      .bind(u.id, due.id, now, u.id, u.id, now - DAY, u.id, now - 7 * DAY)
      .run();
    await env.DB.prepare(
      "UPDATE lifecycle_preferences SET last_checked=? WHERE user_id=?",
    )
      .bind(now, u.id)
      .run();
    if (!claim.meta.changes) continue;
    const pref = await env.DB.prepare(
      "SELECT token,opted_out FROM lifecycle_preferences WHERE user_id=?",
    )
      .bind(u.id)
      .first<{ token: string; opted_out: number }>();
    if (!pref || pref.opted_out) continue;
    const unsubscribe = `https://vertov.app/email/stop?t=${encodeURIComponent(pref.token)}`;
    try {
      const mail = withMailer(env);
      const response = (await mail.EMAIL!.send({
        to: u.email,
        from: env.LIFECYCLE_FROM!,
        ...renderLesson(due, u.name, unsubscribe, env.LIFECYCLE_POSTAL!),
        replyTo: env.LIFECYCLE_REPLY_TO,
        configurationSet: env.LIFECYCLE_CONFIG_SET,
        headers: [
          { Name: "List-Unsubscribe", Value: `<${unsubscribe}>` },
          {
            Name: "List-Unsubscribe-Post",
            Value: "List-Unsubscribe=One-Click",
          },
        ],
      })) as { MessageId?: string };
      await env.DB.prepare(
        "UPDATE lifecycle_sends SET status='accepted',message_id=? WHERE user_id=? AND lesson=?",
      )
        .bind(response.MessageId ?? null, u.id, due.id)
        .run();
      result.accepted++;
    } catch {
      await env.DB.prepare(
        "UPDATE lifecycle_sends SET status='uncertain' WHERE user_id=? AND lesson=?",
      )
        .bind(u.id, due.id)
        .run();
      result.uncertain++;
      break; // Review any uncertain send before allowing the next batch.
    }
  }
  return result;
}
export async function lifecycleUnsubscribe(request: Request, db: D1Database) {
  const token = new URL(request.url).searchParams.get("t");
  const headers = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  };
  if (!token || token.length > 100)
    return new Response("Invalid link", { status: 400, headers });
  const pref = await db
    .prepare("SELECT user_id FROM lifecycle_preferences WHERE token=?")
    .bind(token)
    .first();
  if (!pref) return new Response("Invalid link", { status: 400, headers });
  if (request.method === "POST") {
    await db
      .prepare("UPDATE lifecycle_preferences SET opted_out=1 WHERE token=?")
      .bind(token)
      .run();
    return new Response(
      emailFrame(
        "<h1>You’re unsubscribed.</h1><p>Vertov tips have stopped. Sign-in and account notices still work.</p>",
      ),
      { headers },
    );
  }
  if (request.method !== "GET") return new Response(null, { status: 405 });
  return new Response(
    emailFrame(
      '<h1>Stop Vertov tips?</h1><p>Sign-in and account notices will continue.</p><form method="post"><button style="padding:14px;background:#d92b14;color:white;border:0">Unsubscribe from tips</button></form>',
    ),
    { headers },
  );
}
