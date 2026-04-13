/**
 * Email sender via Resend (https://resend.com).
 * Set RESEND_API_KEY in .env.local to enable.
 * Set EMAIL_FROM to your verified sender (e.g. "VibeScan <hi@vibescan.io>").
 * If not configured, emails are silently skipped.
 */

const RESEND_API = 'https://api.resend.com/emails';

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return; // email not configured — skip silently

  const from = process.env.EMAIL_FROM ?? 'VibeScan <notifications@vibescan.io>';

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.error('[email] Resend error:', res.status, err);
    }
  } catch (err) {
    console.error('[email] fetch failed:', err);
  }
}

function baseTemplate(title: string, body: string, ctaLabel: string, ctaUrl: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://vibescan.io';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title}</title>
<style>
  body { margin: 0; padding: 0; background: #0a0a0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  .wrap { max-width: 520px; margin: 40px auto; padding: 0 20px; }
  .card { background: #13131f; border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 36px 32px; }
  .logo { display: inline-flex; align-items: center; gap: 10px; margin-bottom: 28px; text-decoration: none; }
  .logo-badge { width: 32px; height: 32px; background: rgba(139,92,246,0.2); border: 1px solid rgba(139,92,246,0.35); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; color: #a78bfa; }
  .logo-name { font-size: 16px; font-weight: 600; color: rgba(255,255,255,0.8); }
  h1 { margin: 0 0 12px; font-size: 20px; font-weight: 700; color: #fff; line-height: 1.3; }
  p { margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: rgba(255,255,255,0.5); }
  .cta { display: inline-block; padding: 12px 24px; background: linear-gradient(135deg,#7c3aed,#4f46e5); color: #fff; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 10px; margin-bottom: 8px; }
  .footer { margin-top: 28px; font-size: 12px; color: rgba(255,255,255,0.2); text-align: center; }
  .footer a { color: rgba(139,92,246,0.7); text-decoration: none; }
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <a href="${appUrl}" class="logo">
      <div class="logo-badge">VS</div>
      <span class="logo-name">VibeScan</span>
    </a>
    <h1>${title}</h1>
    ${body}
    <a href="${ctaUrl}" class="cta">${ctaLabel}</a>
  </div>
  <div class="footer">
    <p style="margin:0">You're receiving this because you enabled email notifications on VibeScan.<br/>
    <a href="${appUrl}/profile">Manage notification settings</a></p>
  </div>
</div>
</body>
</html>`;
}

export function commentEmailHtml(
  scanDomain: string,
  commenterName: string,
  commentBody: string,
  scanLink: string,
): string {
  return baseTemplate(
    `New comment on ${scanDomain}`,
    `<p><strong style="color:rgba(255,255,255,0.75)">${escHtml(commenterName)}</strong> commented on your scan of <strong style="color:rgba(255,255,255,0.75)">${escHtml(scanDomain)}</strong>:</p>
     <blockquote style="margin:0 0 20px;padding:12px 16px;background:rgba(255,255,255,0.04);border-left:3px solid rgba(139,92,246,0.5);border-radius:0 8px 8px 0;font-size:14px;color:rgba(255,255,255,0.6);font-style:italic">${escHtml(commentBody)}</blockquote>`,
    'View comment',
    scanLink,
  );
}

export function replyEmailHtml(
  replierName: string,
  replyBody: string,
  scanLink: string,
): string {
  return baseTemplate(
    `${replierName} replied to your comment`,
    `<p><strong style="color:rgba(255,255,255,0.75)">${escHtml(replierName)}</strong> replied to your comment:</p>
     <blockquote style="margin:0 0 20px;padding:12px 16px;background:rgba(255,255,255,0.04);border-left:3px solid rgba(139,92,246,0.5);border-radius:0 8px 8px 0;font-size:14px;color:rgba(255,255,255,0.6);font-style:italic">${escHtml(replyBody)}</blockquote>`,
    'View reply',
    scanLink,
  );
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
