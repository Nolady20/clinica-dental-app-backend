import sgMail from "@sendgrid/mail";

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

export async function sendEmail({ to, subject, html }) {
  try {
    const msg = {
      to,
      from: process.env.FROM_EMAIL,
      subject,
      html,
    };

    await sgMail.send(msg);
    console.log("📨 Email enviado a:", to);
    return true;

  } catch (err) {
    console.error("❌ Error enviando correo:", err);
    return false;
  }
}
