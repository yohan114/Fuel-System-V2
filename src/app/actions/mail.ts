"use server";

import { assertCan } from "@/lib/rbac";
import { isMailConfigured, sendMail } from "@/lib/mail";
import { errorMessage } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function testSendMailAction(formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to send test emails" };
  }

  const recipient = formData.get("recipient")?.toString().trim();
  const subject = formData.get("subject")?.toString().trim() || "FuelSystem Test Email";
  const message = formData.get("message")?.toString().trim() || "This is a test notification from Fuel System V2.";

  if (!recipient) {
    return { error: "Recipient email is required" };
  }

  if (!isMailConfigured()) {
    return {
      error:
        "SMTP is not configured in the environment. Please set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM.",
    };
  }

  try {
    await sendMail({
      to: recipient,
      subject,
      html: `
        <div style="font-family: sans-serif; padding: 20px; background-color: #f4f4f7; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; background: white; padding: 24px; border-radius: 8px; border: 1px solid #e1e4e8;">
            <h2 style="color: #4f46e5; margin-top: 0;">Fuel System V2 — SMTP Test</h2>
            <p>${message}</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
            <p style="font-size: 12px; color: #888;">Sent by administrator ${admin.name} on ${new Date().toLocaleString("en-GB")}.</p>
          </div>
        </div>
      `,
      text: `${message}\n\nSent by administrator ${admin.name} on ${new Date().toLocaleString("en-GB")}.`,
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "TEST",
        entity: "Mail",
        summary: `Sent test email to ${recipient}`,
      },
    });

    return { success: true, message: `Test email sent successfully to ${recipient}.` };
  } catch (err: unknown) {
    console.error("Test send mail error:", err);
    return { error: errorMessage(err) || "Failed to send test email" };
  }
}
