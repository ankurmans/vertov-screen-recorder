/** Shared, email-client-friendly Vertov frame. No remote fonts or tracking pixels. */
export const escapeEmail = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function emailFrame(content: string, preheader = "A note from Vertov") {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body data-vertov-email="true" style="margin:0;background:#ecedeb;color:#141518;font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden">${escapeEmail(preheader)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:8px 0"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#f6f6f4;border-top:3px solid #d92b14"><tr><td style="padding:12px 20px 8px"><a href="https://vertov.app" style="text-decoration:none"><img src="https://vertov.app/logo.png" width="28" height="28" alt="Vertov" style="display:block;border:0"></a></td></tr><tr><td style="padding:8px 20px 24px;font-size:16px;line-height:1.6">${content}</td></tr><tr><td style="padding:16px 20px;border-top:1px solid #c9cbc8;font-size:12px;color:#585b60">Vertov · Record. Share. Get back to work.</td></tr></table></td></tr></table></body></html>`;
}
