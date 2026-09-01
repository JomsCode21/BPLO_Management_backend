import { sendEmail } from "@/utils/mail/mail";

// Sends a password-reset OTP email with expiry guidance.
export const sendForgotPasswordOtpEmail = async (
  email: string,
  otp: string,
  logoUrl: string = "",
) => {
  await sendEmail({
    to: email,
    subject: "BPLO Account Security: Your OTP Code",
    text: `Your password reset code is: ${otp}. It expires in 10 minutes.`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>OTP Verification</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #e2e8f0;">
        
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #e2e8f0; padding: 40px 10px;">
          <tr>
            <td align="center">
              
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 8px 20px rgba(0,0,0,0.08); max-width: 550px;">
                
                <tr>
                  <td align="center" style="background-color: #0F2942; padding: 35px 20px;">
                    ${logoUrl ? `<img src="${logoUrl}" alt="BPLO Logo" style="display: block; max-height: 50px; width: auto;" />` : `<span style="color: #ffffff; font-size: 22px; font-weight: 900; letter-spacing: 3px;">BPLO</span>`}
                  </td>
                </tr>

                <tr>
                  <td style="background-color: #F2C94C; height: 6px; line-height: 6px; font-size: 6px;">&nbsp;</td>
                </tr>
                
                <tr>
                  <td align="center" style="padding: 40px 35px 30px;">
                    <h2 style="color: #0F2942; margin: 0 0 16px; font-size: 22px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">
                      Verification Code
                    </h2>
                    
                    <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 30px;">
                      A password reset was requested for your BPLO account. Please enter the following 6-digit code to securely change your password.
                    </p>
                    
                    <table border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 30px;">
                      <tr>
                        <td align="center" style="background-color: #FFFDF5; border: 2px dashed #F2C94C; border-radius: 8px; padding: 18px 35px;">
                          <span style="font-family: 'Courier New', Courier, monospace; font-size: 38px; font-weight: bold; color: #0F2942; letter-spacing: 14px; margin-right: -14px;">
                            ${otp}
                          </span>
                        </td>
                      </tr>
                    </table>
                    
                    <table border="0" cellspacing="0" cellpadding="0" width="100%" style="margin-bottom: 30px;">
                      <tr>
                        <td align="center" style="background-color: #FEF2F2; border-left: 4px solid #EF4444; padding: 12px 15px; border-radius: 0 6px 6px 0;">
                          <p style="color: #B91C1C; font-size: 13px; font-weight: 600; margin: 0;">
                            For your security, this code will expire in exactly 10 minutes.
                          </p>
                        </td>
                      </tr>
                    </table>

                    <p style="color: #64748B; font-size: 13px; line-height: 1.5; margin: 0;">
                      If you did not request this change, please ignore this email. No changes will be made to your account.
                    </p>
                  </td>
                </tr>
                
                <tr>
                  <td align="center" style="background-color: #F8FAFC; padding: 25px 35px; border-top: 1px solid #E2E8F0;">
                    <p style="color: #94A3B8; font-size: 12px; line-height: 1.6; margin: 0;">
                      <strong>Business Permit and Licensing Office (BPLO)</strong><br>
                      &copy; ${new Date().getFullYear()} All rights reserved.<br>
                      <span style="font-style: italic;">This is an automated system notification.</span>
                    </p>
                  </td>
                </tr>
                
              </table>
              
            </td>
          </tr>
        </table>
        
      </body>
      </html>
    `,
  });
};
