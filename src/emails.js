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
${unsubscribeUrl
    ? `<a href="${esc(unsubscribeUrl)}" style="color:#5f6b65">Stop these emails</a> &middot;
<a href="${esc(config.baseUrl)}/account" style="color:#5f6b65">Notification settings</a>`
    : 'This is a security notice about your account. It is always sent, even if you have turned off other emails.'}
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

// ---------- Viewing emails ----------
const TIME_WINDOWS = {
  morning: { label: 'Morning (8am – 12pm)', start: 8, end: 12 },
  afternoon: { label: 'Afternoon (12pm – 4pm)', start: 12, end: 16 },
  evening: { label: 'Evening (4pm – 7pm)', start: 16, end: 19 },
};
const prettyDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
}).replace(',', ''); // "Friday 6 November 2026"
const prettyPhone = (intl) => (intl ? `0${intl.slice(3, 5)} ${intl.slice(5, 8)} ${intl.slice(8)}` : '');

function detailsTable(rows) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px;border-collapse:collapse">${
    rows.filter(([, v]) => v).map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#5f6b65;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;font-weight:bold">${esc(v)}</td></tr>`).join('')
  }</table>`;
}
const detailsText = (rows) => rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');
const button = (label, href) => `<p style="margin:0 0 20px"><a href="${esc(href)}" style="display:inline-block;background:#0b6b3a;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px">${esc(label)}</a></p>`;

function card({ recipientName, intro, rows, cta, tip, unsubscribeUrl, preheader }) {
  const text = `Hello ${recipientName},

${intro}

${detailsText(rows)}

${cta.label}: ${cta.url}
${tip ? `\n${tip}\n` : ''}
--
${unsubscribeUrl
    ? `To stop these emails: ${unsubscribeUrl}\nNotification settings: ${config.baseUrl}/account`
    : 'This is a security notice about your account. It is always sent, even if you have turned off other emails.'}`;
  const html = layout({
    preheader,
    unsubscribeUrl,
    bodyHtml: `<p style="margin:0 0 12px">Hello ${esc(recipientName)},</p>
<p style="margin:0 0 16px">${esc(intro)}</p>
${detailsTable(rows)}${button(cta.label, cta.url)}${tip ? `<p style="margin:0;font-size:13px;color:#5f6b65">${esc(tip)}</p>` : ''}`,
  });
  return { text, html };
}

const short = (s, n = 50) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// Calendar invite (Ghana is UTC+0 all year, so local times are UTC).
function viewingIcs(v, { uidHost }) {
  const w = TIME_WINDOWS[v.preferred_time] || TIME_WINDOWS.morning;
  const day = v.preferred_date.replace(/-/g, '');
  const pad = (n) => String(n).padStart(2, '0');
  const icsText = (t) => String(t).replace(/[\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const location = [v.address, v.neighbourhood, 'Accra', v.gps_address].filter(Boolean).join(', ');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${icsText(config.siteName)}//Viewings//EN`, 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:viewing-${v.id}@${uidHost}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${day}T${pad(w.start)}0000Z`,
    `DTEND:${day}T${pad(w.end)}0000Z`,
    `SUMMARY:${icsText(`Viewing: ${v.listing_title}`)}`,
    `LOCATION:${icsText(location)}`,
    `DESCRIPTION:${icsText(`Landlord: ${v.landlord_name} (${prettyPhone(v.landlord_phone)}). Call ahead to agree the exact time. Never pay before viewing.`)}`,
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

// To the landlord when a tenant asks to view.
function viewingRequestedEmail({ v, recipientName, dashboardUrl, unsubscribeUrl }) {
  const when = `${prettyDate(v.preferred_date)}, ${(TIME_WINDOWS[v.preferred_time] || {}).label || v.preferred_time}`;
  return {
    subject: `Viewing request: ${v.tenant_name} wants to see "${short(v.listing_title)}"`,
    ...card({
      recipientName, unsubscribeUrl, preheader: `${v.tenant_name} would like to view your property on ${when}.`,
      intro: `${v.tenant_name} would like to view "${v.listing_title}".`,
      rows: [['When', when], ['Tenant', v.tenant_name], ['Phone', prettyPhone(v.tenant_phone)], ['Note', v.note]],
      cta: { label: 'Confirm or decline', url: dashboardUrl },
      tip: 'Please reply soon. Tenants are often looking at several homes at once.',
    }),
  };
}

// To the other party when a viewing is confirmed, declined or cancelled.
function viewingStatusEmail({ v, status, toTenant, recipientName, byName, urls, unsubscribeUrl, uidHost }) {
  const when = `${prettyDate(v.preferred_date)}, ${(TIME_WINDOWS[v.preferred_time] || {}).label || v.preferred_time}`;
  const t = short(v.listing_title);
  if (status === 'confirmed') {
    return {
      subject: `Viewing confirmed: "${t}" on ${prettyDate(v.preferred_date)}`,
      attachments: [{ filename: 'viewing.ics', content: viewingIcs(v, { uidHost }), contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }],
      ...card({
        recipientName, unsubscribeUrl, preheader: `${byName} confirmed your viewing. Address and contact details inside.`,
        intro: `Good news: ${byName} confirmed your viewing of "${v.listing_title}". A calendar invite is attached.`,
        rows: [
          ['When', when],
          ['Address', `${v.address}, ${v.neighbourhood}`],
          ['GhanaPost GPS', v.gps_address],
          ['Landlord', v.landlord_name],
          ['Phone', prettyPhone(v.landlord_phone)],
        ],
        cta: { label: 'View on your dashboard', url: urls.dashboard },
        tip: 'Call the landlord on the day to agree the exact time. Never pay anything before you have seen the property and confirmed who owns it.',
      }),
    };
  }
  if (status === 'declined') {
    return {
      subject: `Viewing not available: "${t}"`,
      ...card({
        recipientName, unsubscribeUrl, preheader: `${byName} couldn't do your requested viewing time.`,
        intro: `${byName} couldn't accept your viewing request for "${v.listing_title}". You can message them to suggest another time, or look at similar homes.`,
        rows: [['Requested', when]],
        cta: { label: `See more homes in ${v.neighbourhood}`, url: urls.similar },
      }),
    };
  }
  // cancelled
  return {
    subject: `Viewing cancelled: "${t}" on ${prettyDate(v.preferred_date)}`,
    ...card({
      recipientName, unsubscribeUrl, preheader: `${byName} cancelled the viewing.`,
      intro: `${byName} cancelled the viewing of "${v.listing_title}".`,
      rows: [['Was planned for', when], [toTenant ? 'Landlord' : 'Tenant', byName]],
      cta: toTenant ? { label: `See more homes in ${v.neighbourhood}`, url: urls.similar } : { label: 'Open your dashboard', url: urls.dashboard },
    }),
  };
}

// ---------- Listing decision emails (to landlords) ----------
const cedis = (n) => `GH₵ ${Number(n).toLocaleString('en-GH', { maximumFractionDigits: 0 })}`;
const listingRows = (l) => [
  ['Listing', l.title],
  ['Area', l.neighbourhood],
  ['Rent', `${cedis(l.rent_ghs)} / month, ${l.advance_months} month${l.advance_months === 1 ? '' : 's'} advance`],
];

function listingDecisionEmail({ listing, action, note, recipientName, urls, unsubscribeUrl }) {
  const t = short(listing.title);
  if (action === 'approve') {
    return {
      subject: `Your listing is live: "${t}"`,
      ...card({
        recipientName, unsubscribeUrl, preheader: 'Tenants can now find your property and contact you directly.',
        intro: `Good news: your listing "${listing.title}" has been approved and is now live. Tenants can find it, message you and book viewings.`,
        rows: listingRows(listing),
        cta: { label: 'View your listing', url: urls.listing },
        tip: 'Tips: reply to enquiries quickly, confirm viewings from your dashboard, and mark the listing as rented once you have found a tenant.',
      }),
    };
  }
  if (action === 'reject') {
    return {
      subject: `Your listing needs changes: "${t}"`,
      ...card({
        recipientName, unsubscribeUrl, preheader: note ? `Reason: ${note}` : 'Please update your listing and resubmit.',
        intro: `Your listing "${listing.title}" was not approved yet. Please make the changes below and save it. It will be reviewed again.`,
        rows: [['Reason', note || 'No reason was given. Please contact support if you are unsure what to change.'], ...listingRows(listing)],
        cta: { label: 'Edit and resubmit', url: urls.edit },
        tip: 'Common fixes: use real, recent photos of this exact property; give the correct rent and advance; describe the rooms, water and electricity; add a GhanaPost GPS address.',
      }),
    };
  }
  // takedown
  return {
    subject: `Your listing was removed: "${t}"`,
    ...card({
      recipientName, unsubscribeUrl, preheader: note ? `Reason: ${note}` : 'Your listing is no longer visible to tenants.',
      intro: `Your listing "${listing.title}" has been removed and is no longer visible to tenants.`,
      rows: [['Reason', note || 'It broke our listing rules.'], ...listingRows(listing)],
      cta: { label: 'Contact support', url: `mailto:${config.supportEmail}` },
      tip: `If you think this is a mistake, reply to ${config.supportEmail} with the listing name.`,
    }),
  };
}

// ---------- Ghana Card verification result (to landlords) ----------
// Never includes the Ghana Card number or image.
function verificationEmail({ status, note, published = [], recipientName, urls, unsubscribeUrl }) {
  if (status === 'verified') {
    const n = published.length;
    let intro = 'Your Ghana Card has been verified. Your listings now show the ✔ verified-landlord badge, and new listings go live as soon as you post them, with no review wait.';
    if (n) intro += ` ${n === 1 ? 'Your listing that was waiting for review is' : `Your ${n} listings that were waiting for review are`} now live:`;
    let cta = { label: 'Post a property', url: urls.newListing };
    if (n === 1) cta = { label: 'View your listing', url: urls.listing(published[0].id) };
    else if (n > 1) cta = { label: 'Open your dashboard', url: urls.dashboard };
    return {
      subject: n ? `You're verified, and ${n === 1 ? 'your listing is' : `${n} listings are`} live` : 'Your Ghana Card is verified',
      ...card({
        recipientName, unsubscribeUrl, intro, cta,
        preheader: 'Your listings now carry the verified-landlord badge.',
        rows: published.map((l) => [l.neighbourhood, `${l.title} (${cedis(l.rent_ghs)} / month)`]),
        tip: 'Tenants are more likely to contact verified landlords. Reply to enquiries quickly and keep your listings up to date.',
      }),
    };
  }
  return {
    subject: "We couldn't verify your Ghana Card",
    ...card({
      recipientName, unsubscribeUrl,
      preheader: note ? `Reason: ${note}` : 'Please upload your Ghana Card again.',
      intro: "We couldn't verify your Ghana Card this time. You can still list properties, but each listing will be reviewed before it goes live. Please try again.",
      rows: [['Reason', note || 'No reason was given. Please contact support if you are unsure what to change.']],
      cta: { label: 'Upload your Ghana Card again', url: urls.account },
      tip: 'Make sure: the photo is sharp and all four corners are visible; the card has not expired; the number is typed exactly as printed (GHA-123456789-0); and the name on the card matches your account name.',
    }),
  };
}

// ---------- Security: password changed ----------
const HOW = {
  reset_code: 'using a reset code sent by SMS',
  reset_link: 'using a reset link sent by email',
  account: 'from your account page',
};

// Always sent (no unsubscribe): it is how people find out someone else got into their account.
function passwordChangedEmail({ recipientName, method, when, device, ip, urls }) {
  return {
    subject: `Your ${config.siteName} password was changed`,
    ...card({
      recipientName,
      preheader: "If this wasn't you, secure your account now.",
      intro: `Your password was changed ${HOW[method] || ''}. For your safety, you have been signed out everywhere else.`.replace('  ', ' '),
      rows: [['When', when], ['Device', device], ['IP address', ip]],
      cta: { label: "This wasn't me: secure my account", url: urls.forgot },
      tip: `If you made this change, you don't need to do anything. If you didn't, reset your password straight away using the button above, then email ${config.supportEmail} so we can check your account and listings.`,
    }),
  };
}

module.exports = {
  passwordChangedEmail,
  newMessageEmail, viewingRequestedEmail, viewingStatusEmail, viewingIcs, listingDecisionEmail, verificationEmail, esc,
};
