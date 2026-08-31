const brevo = require('@getbrevo/brevo');
require('dotenv').config();

// Single module-level instance, reused for every send — matches the pattern
// ported from /Users/mac/Projects/Bramp-Server/services/EmailService.js.
const apiInstance = new brevo.TransactionalEmailsApi();
apiInstance.setApiKey(brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);

function safeParseTemplateId(val) {
  const n = parseInt(val, 10);
  return (!isNaN(n) && n > 0) ? n : null;
}

/**
 * Core sender — template-ID driven only, no raw HTML in the main path.
 */
async function sendEmail({ to, name, templateId, params = {}, options = {} }) {
  if (!templateId || isNaN(templateId) || templateId <= 0) {
    throw new Error(`Invalid template ID: ${templateId}. Check your BREVO_TEMPLATE_* environment variables.`);
  }

  const email = new brevo.SendSmtpEmail();
  email.to = [{ email: to, name }];
  email.templateId = templateId;
  email.params = params;
  if (options.replyTo) email.replyTo = options.replyTo;
  if (options.headers) email.headers = options.headers;

  try {
    const response = await apiInstance.sendTransacEmail(email);
    const messageId = response.body?.messageId || response.messageId || 'No message ID';
    console.log(`Email sent to ${to}: ${messageId}`);
    return { success: true, messageId };
  } catch (error) {
    console.error(`Error sending email to ${to}:`, error.response?.body || error.message);
    throw error;
  }
}

/**
 * The primary auth path (§1/§11 step 2 — signup/login is email + OTP).
 * A send failure here is fatal to the caller's request (the user can't
 * proceed without the code) — that's enforced by the route, not this
 * function, which simply throws on failure like the rest of the module.
 */
async function sendOtpEmail(to, name, otpCode, expirationMinutes = 10) {
  const otpTemplateId = safeParseTemplateId(process.env.BREVO_TEMPLATE_OTP);
  const signupTemplateId = safeParseTemplateId(process.env.BREVO_TEMPLATE_SIGNUP);
  const templateId = otpTemplateId || signupTemplateId;

  if (!templateId) {
    // Local-dev bypass only — never silently succeeds in production. Lets
    // signup/login be tested end-to-end before Brevo templates are set up.
    if (process.env.NODE_ENV === 'production') {
      throw new Error('BREVO_TEMPLATE_OTP or BREVO_TEMPLATE_SIGNUP must be set with a valid template ID');
    }
    console.warn(`[dev] Brevo not configured — OTP for ${to}: ${otpCode} (expires in ${expirationMinutes}m)`);
    return { success: true, messageId: 'dev-bypass' };
  }

  return sendEmail({
    to,
    name,
    templateId,
    params: {
      username: String(name || 'there'),
      otpCode: String(otpCode),
      expirationMinutes: String(expirationMinutes),
    },
  });
}

/**
 * Invite email (floor member or partner) — carries the deep link the
 * recipient uses to join, whether or not they already have an account
 * (the accept flow handles both: log in if they exist, sign up if not).
 * Non-fatal by design: the Invite record already exists in Mongo by the
 * time this is called, so a delivery failure here is logged, not thrown —
 * the desk Principal still gets a success response and can be told to
 * resend later, rather than the whole request failing over an email hiccup.
 */
async function sendInviteEmail(to, { inviterName, deskName, type, deepLink }) {
  const templateId = safeParseTemplateId(process.env.BREVO_TEMPLATE_INVITE);

  if (!templateId) {
    if (process.env.NODE_ENV === 'production') {
      console.error('BREVO_TEMPLATE_INVITE not configured — invite email not sent to', to);
      return { success: false };
    }
    console.warn(`[dev] Brevo not configured — invite for ${to} (${type} on "${deskName}"): ${deepLink}`);
    return { success: true, messageId: 'dev-bypass' };
  }

  return sendEmail({
    to,
    templateId,
    params: {
      inviterName: String(inviterName || 'A colleague'),
      deskName: String(deskName),
      type: String(type),
      deepLink: String(deepLink),
    },
  });
}

module.exports = { sendEmail, sendOtpEmail, sendInviteEmail, safeParseTemplateId };
