// Vercel serverless function: delivers website form submissions through SendGrid.
// Env vars (set in Vercel → Project → Settings → Environment Variables):
//   SENDGRID_API_KEY  – a SendGrid API key with "Mail Send" access
//   MAIL_FROM         – optional, defaults to website@puahfertility.org (must be on the authenticated domain)
// Recipients are chosen here, by department, so a visitor can't send mail to arbitrary addresses.

const INBOX = {
  rabbi:       { to: ['esegelman@puahfertility.org', 'rabbikrohn@puahfertility.org'] },
  shabbos:     { to: ['supervision@puahfertility.org'] },
  supervision: { to: ['supervision@puahfertility.org'] },
  financial:   { to: ['gemach@puahfertility.org'] },
  volunteer:   { to: ['contact@puahfertility.org'], cc: ['joelle@puahfertility.org'] },
  story:       { to: ['contact@puahfertility.org'] },
};

const MAX_FIELD = 5000;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body || {};
  const box = INBOX[body.inbox];
  if (!box) return res.status(400).json({ ok: false, error: 'Unknown form' });

  // Honeypot: real visitors never fill the hidden "website" field.
  if (body.website) return res.status(200).json({ ok: true });

  const fields = Array.isArray(body.fields) ? body.fields.slice(0, 40) : [];
  const clean = fields
    .filter((f) => f && typeof f.name === 'string' && f.value != null && String(f.value).trim() !== '')
    .map((f) => ({ name: f.name.slice(0, 80), value: String(f.value).slice(0, MAX_FIELD) }));
  if (!clean.length) return res.status(400).json({ ok: false, error: 'Empty form' });

  const subject = '[Website] ' + String(body.subject || 'Message').slice(0, 120);
  const emailField = clean.find((f) => /^e-?mail$/i.test(f.name));
  const replyTo = emailField && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailField.value) ? emailField.value : null;
  const first = clean.find((f) => f.name === 'First name');
  const last = clean.find((f) => f.name === 'Last name');
  const visitor = [first && first.value, last && last.value].filter(Boolean).join(' ');

  const text = clean.map((f) => `${f.name}: ${f.value}`).join('\n') + `\n\n— Sent from the PUAH website form "${body.subject || ''}"`;
  const html =
    `<table cellpadding="6" style="font-family:Arial,sans-serif;font-size:14px;border-collapse:collapse">` +
    clean.map((f) => `<tr><td style="vertical-align:top;color:#555;white-space:nowrap"><b>${esc(f.name)}</b></td><td style="white-space:pre-wrap">${esc(f.value)}</td></tr>`).join('') +
    `</table><p style="font-family:Arial,sans-serif;font-size:12px;color:#888">Sent from the PUAH website. Reply to this email to answer ${replyTo ? esc(replyTo) : 'the sender'}.</p>`;

  const personalization = { to: box.to.map((email) => ({ email })) };
  if (box.cc) personalization.cc = box.cc.map((email) => ({ email }));

  const payload = {
    personalizations: [personalization],
    from: { email: process.env.MAIL_FROM || 'website@puahfertility.org', name: visitor ? `${visitor} via PUAH Website` : 'PUAH Website' },
    subject,
    content: [
      { type: 'text/plain', value: text },
      { type: 'text/html', value: html },
    ],
    tracking_settings: { click_tracking: { enable: false }, open_tracking: { enable: false } },
  };
  if (replyTo) payload.reply_to = { email: replyTo, name: visitor || undefined };

  try {
    const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (r.status >= 200 && r.status < 300) return res.status(200).json({ ok: true });
    console.error('SendGrid error', r.status, await r.text());
    return res.status(502).json({ ok: false, error: 'Mail service error' });
  } catch (e) {
    console.error('SendGrid request failed', e);
    return res.status(502).json({ ok: false, error: 'Mail service unreachable' });
  }
};

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
