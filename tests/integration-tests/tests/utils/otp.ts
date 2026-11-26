/**
 * Citizen OTP — one place that decides where a sign-in / registration OTP comes from.
 *
 *   OTP_SINK_URL set   → read the OTP the deployment actually sent, from its
 *                         test-only SMS sink (environments/<env>/config.env).
 *   OTP_SINK_URL unset → FIXED_OTP (secrets.env, default 123456), for deployments
 *                         that accept one fixed code.
 *
 * Deliberately NO fallback from a configured sink to the fixed code: on a
 * deployment with real OTPs the fixed code is simply wrong, so falling back would
 * turn "the sink is broken" into a confusing "invalid OTP" further down. A sink
 * that yields nothing throws with the reason instead.
 *
 * Sink contract (same as the DIGIT 3.0 suite's reader): GET <OTP_SINK_URL>?phone=<digits>
 * answers [{ phone: "+254…", otp: "123456", at: "<ISO time>" }, …]. We take the
 * newest message for this number sent after the request (2 s clock skew allowed),
 * polling for up to 30 s.
 *
 * Callers record `sentAt = Date.now()` immediately BEFORE the /user-otp/v1/_send
 * call, then ask for the code.
 */
import { FIXED_OTP, OTP_SINK_URL } from './env';

/** 'sink' or 'fixed' — for skip reasons and annotations, never the code itself. */
export function otpSource(): 'sink' | 'fixed' {
  return OTP_SINK_URL ? 'sink' : 'fixed';
}

export async function resolveCitizenOtp(mobileNumber: string, sentAt: number): Promise<string> {
  if (!OTP_SINK_URL) return FIXED_OTP;
  const digits = mobileNumber.replace(/\D/g, '');
  const url = new URL(OTP_SINK_URL);
  url.searchParams.set('phone', digits);
  const since = sentAt - 2_000;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const response = await fetch(url, { headers: { accept: 'application/json' } }).catch(() => null);
    if (response?.ok) {
      const messages = (await response.json().catch(() => [])) as Array<{ phone?: string; otp?: string; at?: string }>;
      const match = (Array.isArray(messages) ? messages : [])
        .filter(
          (m) =>
            typeof m.otp === 'string' &&
            /^\d{4,8}$/.test(m.otp) &&
            typeof m.phone === 'string' &&
            m.phone.replace(/\D/g, '').endsWith(digits) &&
            Date.parse(m.at ?? '') >= since,
        )
        .sort((a, b) => Date.parse(b.at!) - Date.parse(a.at!))[0];
      if (match) return match.otp!;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`No OTP for this number reached the SMS sink within 30 s (${url.origin}${url.pathname})`);
}
