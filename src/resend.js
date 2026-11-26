const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.CONTACT_FROM_EMAIL || 'onboarding@resend.dev';
const TO_EMAIL = process.env.CONTACT_TO_EMAIL || 'krishnapriyapaiv@gmail.com';

function buildText({ name, email, phone, subject, message }) {
  return [
    `Name: ${name}`,
    `Email: ${email}`,
    `Phone: ${phone || 'Not provided'}`,
    `Subject: ${subject || 'Contact form message'}`,
    '',
    message
  ].join('\n');
}

async function sendContactEmail(details) {
  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY is not set; contact email was not sent.');
    return { skipped: true };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [TO_EMAIL],
      reply_to: details.email,
      subject: `Cloud Kitchen contact: ${details.subject || 'New message'}`,
      text: buildText(details)
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || `Resend request failed with HTTP ${response.status}`);
  }
  return data;
}

module.exports = { sendContactEmail };
