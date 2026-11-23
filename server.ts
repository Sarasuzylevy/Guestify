import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import nodemailer from 'nodemailer';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const firebaseConfigPath = path.resolve(__dirname, 'firebase-applet-config.json');
const firebaseConfig = JSON.parse(readFileSync(firebaseConfigPath, 'utf-8')) as {
  apiKey: string;
  projectId: string;
};

// Track UIDs that already received a welcome email to prevent duplicate sends or replay spam
const sentWelcomeEmailByUid = new Map<string, number>();
const WELCOME_DEDUPE_MS = 24 * 60 * 60 * 1000;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeAppUrl(reqHost?: string, rawUrl?: unknown): string {
  const envUrl = process.env.APP_URL?.trim();
  const allowedHosts = new Set<string>();

  if (envUrl) {
    try {
      const parsedEnv = new URL(envUrl);
      allowedHosts.add(parsedEnv.hostname);
      if (parsedEnv.hostname.startsWith('ais-dev-')) {
        allowedHosts.add(parsedEnv.hostname.replace(/^ais-dev-/, 'ais-pre-'));
      }
    } catch {
      // Ignore malformed APP_URL
    }
  }

  if (reqHost) {
    const cleanHost = reqHost.split(',')[0].trim().split(':')[0].toLowerCase();
    if (cleanHost) {
      allowedHosts.add(cleanHost);
      if (cleanHost.startsWith('ais-dev-')) {
        allowedHosts.add(cleanHost.replace(/^ais-dev-/, 'ais-pre-'));
      }
    }
  }

  const candidates = [envUrl || '', typeof rawUrl === 'string' ? rawUrl.trim() : ''];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      const hostname = parsed.hostname.toLowerCase();
      if (parsed.protocol === 'https:' && (allowedHosts.size === 0 || allowedHosts.has(hostname))) {
        const publicHost = hostname.startsWith('ais-dev-')
          ? hostname.replace(/^ais-dev-/, 'ais-pre-')
          : hostname;
        return `https://${publicHost}${parsed.port ? `:${parsed.port}` : ''}`;
      }
      if (
        parsed.protocol === 'http:' &&
        (hostname === 'localhost' || hostname === '127.0.0.1')
      ) {
        return `${parsed.protocol}//${parsed.host}`;
      }
    } catch {
      // Try next candidate
    }
  }

  return 'https://guestify.app';
}

function computeAcronym(name: string, email: string): string {
  const clean = name.trim();
  if (!clean) return (email.slice(0, 2).toUpperCase() || 'GM').slice(0, 10);
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase().slice(0, 10);
  }
  return (clean.slice(0, 2).toUpperCase() || 'GM').slice(0, 10);
}

interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
}

async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseUser | null> {
  if (!idToken || idToken.length > 8192 || !firebaseConfig.apiKey) {
    return null;
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }
  );

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as {
    users?: Array<{
      localId?: string;
      email?: string;
      displayName?: string;
      emailVerified?: boolean;
    }>;
  };

  const user = data?.users?.[0];
  if (!user?.localId || !user?.email) {
    return null;
  }

  return {
    uid: user.localId,
    email: user.email.trim().toLowerCase(),
    displayName: (user.displayName || '').trim(),
    emailVerified: Boolean(user.emailVerified),
  };
}

function buildWelcomeEmailContent(params: {
  name: string;
  email: string;
  appUrl: string;
}): { subject: string; html: string; text: string } {
  const displayName = params.name.trim() || params.email.split('@')[0] || 'Friend';
  const acronym = computeAcronym(displayName, params.email);
  const safeName = escapeHtml(displayName);
  const safeEmail = escapeHtml(params.email);
  const safeAcronym = escapeHtml(acronym);
  const safeUrl = escapeHtml(params.appUrl);

  const subject = `Welcome to Guestify, ${displayName}!`;

  const text = [
    `Welcome to Guestify, ${displayName}!`,
    '',
    `Your Guestify account (${params.email}) is now active.`,
    `Your guest initials: ${acronym}`,
    '',
    'With Guestify, you can:',
    '- Receive & respond to wedding invitations in real time',
    '- Plan your own wedding: checklist, budget, invitation card & guest list',
    '- Discover & message wedding vendors directly',
    '',
    `Open Guestify: ${params.appUrl}`,
    '',
    'Warmly,',
    'The Guestify Team',
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to Guestify</title>
</head>
<body style="margin:0;padding:24px 12px;background-color:#FAF8F5;font-family:Georgia, 'Times New Roman', serif;color:#2D2825;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;margin:0 auto;background-color:#FFFFFF;border:1px solid #E8DED5;border-radius:20px;overflow:hidden;">
    <tr>
      <td style="padding:36px 28px;background:linear-gradient(135deg,#FAF5F0 0%,#F3E7DC 100%);text-align:center;border-bottom:1px solid #E8DED5;">
        <div style="font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#8B5E3C;margin-bottom:8px;">
          Welcome to Guestify
        </div>
        <h1 style="margin:0;font-size:30px;line-height:1.2;color:#2D2825;font-weight:700;">
          Hello, ${safeName}
        </h1>
        <p style="margin:10px 0 0 0;font-family:Arial,sans-serif;font-size:13px;color:#6E645E;">
          Your personal wedding coordination account is ready.
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding:30px 28px;">
        <p style="margin:0 0 16px 0;font-family:Arial,sans-serif;font-size:14px;line-height:1.65;color:#4A423D;">
          Thank you for creating your account on <strong>Guestify</strong>. Everything you save is synchronized across your devices so you can organize your wedding or respond to invitations effortlessly.
        </p>

        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#FAF8F5;border:1px solid #E8DED5;border-radius:14px;margin:20px 0;">
          <tr>
            <td style="padding:18px 20px;font-family:Arial,sans-serif;font-size:13px;line-height:1.7;color:#4A423D;">
              <div style="margin-bottom:6px;"><strong style="color:#8B5E3C;">Account Email:</strong> ${safeEmail}</div>
              <div><strong style="color:#8B5E3C;">Your Member Initials:</strong> ${safeAcronym}</div>
            </td>
          </tr>
        </table>

        <ul style="margin:0 0 24px 0;padding-left:20px;font-family:Arial,sans-serif;font-size:13px;line-height:1.75;color:#4A423D;">
          <li><strong>Guest Workspace:</strong> View wedding invitations, schedules, venues, and RSVP live.</li>
          <li><strong>Plan Your Marriage:</strong> Manage your wedding checklist, budget, invitation card, and guest list.</li>
          <li><strong>Vendor Hub:</strong> Explore curated wedding vendors and chat directly with professionals.</li>
        </ul>

        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td style="text-align:center;padding:8px 0;">
              <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 32px;background-color:#2D2825;color:#FFFFFF;font-family:Arial,sans-serif;font-size:13px;font-weight:700;text-decoration:none;border-radius:999px;letter-spacing:0.3px;">
                Open Guestify
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:18px 28px;background-color:#FAF8F5;border-top:1px solid #E8DED5;text-align:center;font-family:Arial,sans-serif;font-size:11px;color:#8C7E74;">
        Sent by Guestify · Wedding Coordination &amp; Vendor Hub
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}

async function deliverTransactionalEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ sent: true; provider: 'resend' | 'smtp' } | { sent: false; reason: string }> {
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  const smtpUser = process.env.SMTP_USER?.trim();
  const smtpPass = process.env.SMTP_PASS?.trim();
  const smtpHost = process.env.SMTP_HOST?.trim() || (smtpUser?.endsWith('@gmail.com') ? 'smtp.gmail.com' : '');
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const fromAddress =
    process.env.EMAIL_FROM?.trim() ||
    (smtpUser ? `Guestify <${smtpUser}>` : 'Guestify <onboarding@resend.dev>');

  if (resendApiKey) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [params.to],
        subject: params.subject,
        html: params.html,
        text: params.text,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Resend API error (${res.status}): ${errBody.slice(0, 200)}`);
    }
    return { sent: true, provider: 'resend' };
  }

  if (smtpHost && smtpUser && smtpPass) {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number.isFinite(smtpPort) ? smtpPort : 587,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    await transporter.sendMail({
      from: fromAddress,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
    });
    return { sent: true, provider: 'smtp' };
  }

  return { sent: false, reason: 'EMAIL_PROVIDER_NOT_CONFIGURED' };
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '32kb' }));

  app.post('/api/welcome-email', async (req, res) => {
    try {
      const authHeader = req.headers.authorization || '';
      const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!idToken) {
        res.status(401).json({ sent: false, error: 'Missing authentication token.' });
        return;
      }

      const verifiedUser = await verifyFirebaseIdToken(idToken);
      if (!verifiedUser) {
        res.status(401).json({ sent: false, error: 'Invalid or expired authentication token.' });
        return;
      }

      const lastSent = sentWelcomeEmailByUid.get(verifiedUser.uid);
      if (lastSent && Date.now() - lastSent < WELCOME_DEDUPE_MS) {
        res.status(200).json({ sent: true, alreadySent: true });
        return;
      }

      const rawDisplayName =
        typeof req.body?.name === 'string' && req.body.name.trim()
          ? req.body.name.trim().slice(0, 120)
          : verifiedUser.displayName;
      const requestHost =
        (typeof req.headers['x-forwarded-host'] === 'string'
          ? req.headers['x-forwarded-host']
          : req.headers.host) || '';
      const appUrl = sanitizeAppUrl(requestHost, req.body?.appUrl);

      const content = buildWelcomeEmailContent({
        name: rawDisplayName,
        email: verifiedUser.email,
        appUrl,
      });

      const result = await deliverTransactionalEmail({
        to: verifiedUser.email,
        subject: content.subject,
        html: content.html,
        text: content.text,
      });

      if (result.sent) {
        sentWelcomeEmailByUid.set(verifiedUser.uid, Date.now());
      }

      res.status(200).json(result);
    } catch (err: any) {
      console.error('Welcome email route error:', err?.message || err);
      res.status(500).json({ sent: false, error: 'Unable to send welcome email right now.' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Guestify server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
