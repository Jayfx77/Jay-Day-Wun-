// Email templates. All user-supplied text is HTML-escaped.
const config = require('./config');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout({ preheader, bodyHtml, unsubscribeUrl }) {
  return `<!doctype html><html><body style="margin:0;background:#f4f6f5;font-family:Arial,Helvetica,sans-serif;color:#1b1f1d">
<span style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px">
<tr><td style="background:#0b6b3a;color:#ffffff;padding:16px 24px;border-radius:12px 12px 0 0;font-size:18px;font-weight:bold">
<span style="color:#f2b705">&#9670;</span> ${esc(config.siteName)}</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55">${bodyHtml}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e2e6e4;font-size:12px;color:#5f6b65">
Rent directly from landlords in Accra. Never pay before viewing a property.<br>
<a href="${esc(unsubscribeUrl)}" style="color:#5f6b65">Stop message emails</a> &middot;
<a href="${esc(config.baseUrl)}/account" style="color:#5f6b65">Notification settings</a>
</td></tr></table></td></tr></table></body></html>`;
}

function newMessageEmail({ recipientName, senderName, listingTitle, body, conversationUrl, unsubscribeUrl }) {
  const preview = body.length > 600 ? `${body.slice(0, 600)}…` : body;
  const subject = `New message from ${senderName} about "${listingTitle.length > 50 ? `${listingTitle.slice(0, 49)}…` : listingTitle}"`;
  const text = `Hello ${recipientName},

${senderName} sent you a message on ${config.siteName} about "${listingTitle}":

${preview.split('\n').map((l) => `> ${l}`).join('\n')}

Reply here: ${conversationUrl}

Safety tip: never send money before you have viewed the property and confirmed who owns it.

--
To stop these emails: ${unsubscribeUrl}
Notification settings: ${config.baseUrl}/account`;
  const html = layout({
    preheader: `${senderName}: ${preview.slice(0, 90)}`,
    unsubscribeUrl,
    bodyHtml: `<p style="margin:0 0 12px">Hello ${esc(recipientName)},</p>
<p style="margin:0 0 12px"><strong>${esc(senderName)}</strong> sent you a message about <strong>${esc(listingTitle)}</strong>:</p>
<div style="background:#e5f3eb;border-left:4px solid #0b6b3a;padding:12px 16px;border-radius:8px;white-space:pre-wrap;margin:0 0 20px">${esc(preview)}</div>
<p style="margin:0 0 20px"><a href="${esc(conversationUrl)}" style="display:inline-block;background:#0b6b3a;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px">Reply to ${esc(senderName.split(' ')[0])}</a></p>
<p style="margin:0;font-size:13px;color:#5f6b65">&#128737; Never send money before you have viewed the property and confirmed who owns it.</p>`,
  });
  return { subject, text, html };
}

module.exports = { newMessageEmail, esc };
