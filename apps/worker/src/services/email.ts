import type { Env } from '../env.js';

const SENDER_ADDR = 'noreply@agentdrive.sh';
const SENDER_NAME = 'AgentDrive';

export class EmailService {
  constructor(private env: Env) {}

  async sendMagicCode(email: string, code: string, purpose: 'verify' | 'login'): Promise<boolean> {
    const subject = purpose === 'login'
      ? `Your AgentDrive login code: ${code}`
      : `Verify your email for AgentDrive: ${code}`;

    const action = purpose === 'login' ? 'sign in' : 'verify your email';
    const html = `
      <div style="font-family: -apple-system, sans-serif; max-width: 400px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #fff; font-size: 20px; margin-bottom: 8px;">AgentDrive</h2>
        <p style="color: #a1a1aa; font-size: 14px; margin-bottom: 24px;">
          ${purpose === 'login' ? 'Enter this code to sign in:' : 'Enter this code to verify your email:'}
        </p>
        <div style="background: #18181b; border: 1px solid #27272a; border-radius: 8px; padding: 24px; text-align: center; margin-bottom: 24px;">
          <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #fff;">${code}</span>
        </div>
        <p style="color: #71717a; font-size: 12px;">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
      </div>
    `;
    const text = `Your AgentDrive code is ${code}. Enter it to ${action}. It expires in 10 minutes. If you didn't request this, ignore this email.`;

    // Cloudflare Email Sending delivers to arbitrary recipients once the sender
    // domain (agentdrive.sh) is onboarded via `wrangler email sending enable`.
    // No API key — the send_email binding is the transport.
    if (this.env.SEND_EMAIL) {
      try {
        await this.env.SEND_EMAIL.send({
          from: { email: SENDER_ADDR, name: SENDER_NAME },
          to: email,
          subject,
          html,
          text,
        });
        return true;
      } catch (err) {
        // E_SENDER_NOT_VERIFIED here means the domain isn't onboarded to Email
        // Sending yet; E_RATE_LIMIT_EXCEEDED / E_DELIVERY_FAILED are transient.
        console.error('SEND_EMAIL send failed:', err);
        return false;
      }
    }

    // Binding not bound. In production this is a misconfiguration we must
    // surface instead of pretending the code was sent (the old behavior, which
    // silently dropped every code). Locally we log it so dev/test flows work.
    if (this.env.ENVIRONMENT === 'production') {
      console.error('SEND_EMAIL binding not configured — cannot send magic code to', email);
      return false;
    }
    console.warn('No email transport; logging magic code:', { email, code, purpose });
    return true;
  }

  async registerAgentInbox(agentName: string, displayName: string): Promise<{
    id: string;
    email: string;
    api_key: string;
    claim_url: string;
  } | null> {
    const mmKey = this.env.MAILMOLT_API_KEY;
    if (!mmKey) {
      console.warn('inbox provider key not set, skipping agent inbox registration');
      return null;
    }

    const res = await fetch('https://api.mailmolt.com/v1/agents/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: agentName,
        display_name: displayName,
        owner_hint: `AgentDrive agent: ${displayName}`,
      }),
    });

    if (!res.ok) {
      console.error('agent inbox register failed:', res.status, await res.text());
      return null;
    }

    const data = await res.json() as {
      id: string;
      email: string;
      api_key: string;
      claim_token: string;
      claim_url: string;
    };

    return {
      id: data.id,
      email: data.email,
      api_key: data.api_key,
      claim_url: data.claim_url,
    };
  }
}

export function generateMagicCode(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  const num = ((bytes[0] << 16) | (bytes[1] << 8) | bytes[2]) % 1000000;
  return String(num).padStart(6, '0');
}
