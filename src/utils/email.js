import nodemailer from "nodemailer";

export const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false, // Gmail con puerto 465 siempre usa secure=true
  requireTLS: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

export async function sendEmail({ to, subject, html }) {
  try {
    const info = await mailer.sendMail({
      from: `"Clinica Dental" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html
    });

    console.log("📨 Email enviado:", info.messageId);
    return true;

  } catch (err) {
    console.error("❌ Error enviando correo:", err);
    return false;
  }
}
