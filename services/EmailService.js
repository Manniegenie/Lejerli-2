const brevo = require('@getbrevo/brevo');
require('dotenv').config();

const apiInstance = new brevo.TransactionalEmailsApi();
apiInstance.setApiKey(brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);

const COMPANY_NAME  = process.env.COMPANY_NAME  || 'Lejerli';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@lejerli.com';
const SENDER_EMAIL  = process.env.SENDER_EMAIL  || process.env.SUPPORT_EMAIL || 'noreply@lejerli.com';
const SENDER_NAME   = process.env.SENDER_NAME   || process.env.COMPANY_NAME  || 'Lejerli';

function safeParseTemplateId(envVar, fallback = null) {
  const parsed = parseInt(envVar);
  if (isNaN(parsed)) return fallback;
  return parsed;
}

function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

async function sendEmail({ to, name, templateId, params = {}, htmlContent = null }) {
  if (!process.env.BREVO_API_KEY) {
    throw new Error('BREVO_API_KEY is not configured');
  }

  const email = new brevo.SendSmtpEmail();
  email.to = [{ email: to, name }];
  email.sender = { email: SENDER_EMAIL, name: SENDER_NAME };

  if (templateId) {
    email.templateId = templateId;
    email.params = params;
  } else {
    // Fallback: inline HTML
    email.subject = params.subject || `${COMPANY_NAME} - Verification Code`;
    email.htmlContent = htmlContent;
  }

  console.log(`📧 Sending email to ${to} [Template: ${templateId || 'inline'}]`);
  const response = await apiInstance.sendTransacEmail(email);
  console.log('✅ Email sent:', response.body?.messageId || response.messageId);
  return { success: true, messageId: response.body?.messageId || response.messageId };
}

async function sendEmailVerificationOTP(to, name, otp, expiryMinutes = 10) {
  try {
    const templateId = safeParseTemplateId(process.env.BREVO_TEMPLATE_EMAIL_VERIFICATION);
    const expiryTime = new Date(Date.now() + expiryMinutes * 60 * 1000);

    const params = {
      username:      String(name || 'User'),
      otp:           String(otp),
      expiryMinutes: String(expiryMinutes),
      expiryTime:    formatDate(expiryTime),
      companyName:   String(COMPANY_NAME),
      supportEmail:  String(SUPPORT_EMAIL),
    };

    const htmlContent = `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0a0a0a;color:#fff;border-radius:12px">
        <h2 style="color:#F26522">Verify your email</h2>
        <p>Hi ${name || 'there'},</p>
        <p>Your ${COMPANY_NAME} verification code is:</p>
        <div style="font-size:40px;font-weight:700;letter-spacing:12px;text-align:center;padding:24px;background:#1a1a1a;border-radius:8px;color:#F26522;margin:24px 0">
          ${otp}
        </div>
        <p style="color:#888">This code expires in <strong style="color:#fff">${expiryMinutes} minutes</strong> (${formatDate(expiryTime)}).</p>
        <p style="color:#888;font-size:12px">If you didn't request this, ignore this email.</p>
        <p style="color:#555;font-size:12px">${COMPANY_NAME} · ${SUPPORT_EMAIL}</p>
      </div>
    `;

    return await sendEmail({ to, name, templateId, params, htmlContent });
  } catch (error) {
    console.error('Failed to send verification OTP:', error.message);
    throw error;
  }
}

module.exports = { sendEmailVerificationOTP };
