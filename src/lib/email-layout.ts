/** Shared, email-client-friendly Vertov frame. No remote fonts or tracking pixels. */
export const escapeEmail = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const EMAIL_POSTAL = "Your organisation, your postal address";

/** Shared action button; modest rounding works without depending on a media query. */
export function emailButton(href: string, label: string) {
  return `<a href="${escapeEmail(href)}" style="background:#d92b14;color:#fff;text-decoration:none;padding:12px 20px;display:inline-block;font-weight:bold;border-radius:6px">${escapeEmail(label)}</a>`;
}

export function emailFrame(content: string, preheader = "A note from Vertov", postal = EMAIL_POSTAL) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body data-vertov-email="true" style="margin:0;padding:0;background:#ecedeb;color:#141518;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%"><div style="display:none;max-height:0;overflow:hidden;font-size:0;line-height:0;mso-hide:all">${escapeEmail(preheader)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr><td align="center" style="padding:0"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#f6f6f4;border-top:3px solid #d92b14;border-collapse:collapse"><tr><td style="padding:12px 20px 8px"><a href="https://vertov.app" style="text-decoration:none;color:#141518"><table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr><td width="28" valign="middle"><img src="https://vertov.app/logo.png" width="28" height="28" alt="" style="display:block;border:0"></td><td valign="middle" style="padding-left:9px;font-size:22px;line-height:28px;font-weight:bold;letter-spacing:-.7px;color:#141518">Vertov</td></tr></table></a></td></tr><tr><td style="padding:8px 20px 16px;font-size:16px;line-height:1.6">${content}</td></tr><tr><td style="padding:12px 20px;border-top:1px solid #c9cbc8;font-size:12px;line-height:1.5;color:#585b60"><p style="margin:0 0 4px">Vertov · Record. Share. Get back to work.</p><p style="margin:0">${escapeEmail(postal)}</p></td></tr></table></td></tr></table></body></html>`;
}

/** Editorial teaching artwork. No customer recordings or customer metadata in remote image URLs. */
export function emailVisual(_file: string, _alt: string, _href?: string) { return ""; }

/** Structured activity message. A view is a share-page visit, not a claim of completed playback. */
export function activityEmail(title: string | null, url: string, viewed: boolean, comments: number, settingsUrl: string) {
  const name = title || "Untitled video";
  const count = Math.max(0, Math.floor(comments));
  const label = count ? `${count === 1 ? "New comment" : `${count} new comments`}${viewed ? " and a first view" : ""}` : "First view";
  const subject = count ? (viewed ? "New video activity 💬" : count === 1 ? "New video comment 💬" : "New video comments 💬") : "Your first view 👀";
  const summary = [viewed ? "Your video has its first external share-page view." : "", count ? `${count} new comment${count === 1 ? " is" : "s are"} waiting on the video.` : ""].filter(Boolean).join(" ");
  const text = `${label}\n\n${name}\n\n${summary}\n\nOpen video activity: ${url}\n\nManage notifications: ${settingsUrl}`;
  const html = emailFrame(`<h1 style="margin:0 0 14px;font-size:26px;line-height:1.2">${escapeEmail(label)}</h1><p style="font-weight:bold">${escapeEmail(name)}</p><p>${escapeEmail(summary)}</p><p style="margin:20px 0">${emailButton(url, "Open video activity")}</p><p style="font-size:12px;color:#585b60"><a href="${escapeEmail(settingsUrl)}" style="color:#585b60">Manage notifications</a></p>`, subject);
  return { subject, html, text };
}
