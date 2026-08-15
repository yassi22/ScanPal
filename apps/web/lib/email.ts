import "server-only";

import { Resend } from "resend";
import { env } from "@/lib/env";

export function isEmailConfigured(): boolean {
  return Boolean(env.resendApiKey);
}

export async function sendInviteEmail(input: {
  to: string;
  teamName: string;
  inviteUrl: string;
}): Promise<void> {
  if (!env.resendApiKey) {
    console.warn(
      "RESEND_API_KEY ontbreekt — uitnodigingsmail niet verstuurd naar",
      input.to,
    );
    return;
  }

  const resend = new Resend(env.resendApiKey);
  const { error } = await resend.emails.send({
    from: env.resendFrom,
    to: input.to,
    subject: `Je bent uitgenodigd voor ${input.teamName} op ScanPal`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #1e293b;">
        <h1 style="font-size: 20px; margin: 0 0 12px;">Team-uitnodiging</h1>
        <p style="font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
          Je bent uitgenodigd om lid te worden van <strong>${input.teamName}</strong>
          op ScanPal. Klik op de onderstaande knop om de uitnodiging te accepteren.
        </p>
        <a href="${input.inviteUrl}" style="display: inline-block; background: #2dd4bf; color: #0f172a; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 8px;">
          Uitnodiging accepteren
        </a>
        <p style="font-size: 13px; line-height: 1.6; color: #64748b; margin: 24px 0 0;">
          Deze link is 7 dagen geldig. Werkt de knop niet? Kopieer deze URL:
          <br /><span style="word-break: break-all;">${input.inviteUrl}</span>
        </p>
      </div>
    `,
  });

  if (error) {
    console.error("uitnodigingsmail mislukt:", error);
  }
}
