import { sendEmail } from "@/utils/mail/mail"; // Adjust this import based on your setup

// Sends registration OTP email used for account verification.
export const sendRegistrationOtpEmail = async (
  email: string,
  otp: string,
  logoUrl: string = "",
) => {
  await sendEmail({
    to: email,
    subject: "Verify Your Email - BPLO System Registration",
    text: `Welcome to the Business Permit and Licensing Office (BPLO) System. Your email verification OTP is: ${otp}. It expires in 10 minutes.`,
    html: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; color: #333; border: 1px solid #eaeaea; border-radius: 8px; overflow: hidden;">
        
        <div style="background-color: #0F2942; padding: 28px 20px; text-align: center;">
          ${logoUrl ? `<img src="${logoUrl}" alt="BPLO Logo" style="display: inline-block; max-height: 50px; width: auto;" />` : `<span style="color: #ffffff; font-size: 22px; font-weight: 900; letter-spacing: 3px;">BPLO</span>`}
        </div>
        <div style="height: 4px; background-color: #F2C94C;"></div>

        <div style="padding: 30px;">
        <h2 style="color: #0f172a; margin-bottom: 20px; text-align: center;">Account Verification</h2>
        
        <p style="font-size: 16px; line-height: 1.6; color: #475569;">
          Welcome to the Business Permit and Licensing Office (BPLO) System. To complete your registration and secure your account, please verify your email address.
        </p>
        
        <p style="font-size: 16px; line-height: 1.6; color: #475569;">
          Enter the following 6-digit verification code in the application:
        </p>
        
        <div style="margin: 35px 0; text-align: center;">
          <span style="display: inline-block; background-color: #f8fafc; color: #0f172a; padding: 16px 32px; border-radius: 8px; font-weight: 700; font-size: 28px; letter-spacing: 6px; border: 1px solid #cbd5e1;">
            ${otp}
          </span>
        </div>
        
        <p style="font-size: 14px; color: #ef4444; font-weight: 600; text-align: center;">
          ⚠️ This verification code will expire in 10 minutes.
        </p>

        <p style="font-size: 14px; color: #64748b; line-height: 1.5; margin-top: 30px;">
          If you did not attempt to register an account with us, please disregard this email.
        </p>

        <hr style="margin: 30px 0; border: none; border-top: 1px solid #e2e8f0;" />

        <p style="font-size: 12px; color: #94a3b8; text-align: center;">
          Business Permit and Licensing Office (BPLO) System<br/>
          This is an automated message, please do not reply.
        </p>
        </div>
      </div>
    `,
  });
};
