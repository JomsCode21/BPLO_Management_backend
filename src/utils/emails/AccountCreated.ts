import { sendEmail } from "@/utils/mail/mail";

// Sends account creation credentials and onboarding guidance email.
export const sendAccountCreatedEmail = async (
  email: string,
  firstName: string,
  password: string,
  role: string,
  logoUrl: string = "",
) => {
  const roleDisplay = role
    .replace("_", " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  await sendEmail({
    to: email,
    subject: "Welcome to BPLO - Your Account Details",
    text: `Hello ${firstName}, Your account has been created in the Business Permit and Licensing Office (BPLO) System. Email: ${email}, Temporary Password: ${password}. Role: ${roleDisplay}. Please change your password after your first login.`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Account Created</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f1f5f9;">
        
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 40px 10px;">
          <tr>
            <td align="center">
              
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); max-width: 600px;">
                
                <!-- Header -->
                <tr>
                  <td align="center" style="background-color: #0F2942; padding: 30px 20px;">
                    ${logoUrl ? `<img src="${logoUrl}" alt="BPLO Logo" style="display: block; max-height: 60px; width: auto;" />` : `<span style="color: #ffffff; font-size: 22px; font-weight: 900; letter-spacing: 3px;">BPLO</span>`}
                  </td>
                </tr>

                <!-- Accent Line -->
                <tr>
                  <td style="background-color: #F2C94C; height: 4px; font-size: 0;">&nbsp;</td>
                </tr>
                
                <!-- Content -->
                <tr>
                  <td style="padding: 40px 40px 20px;">
                    <h1 style="color: #1e293b; margin: 0 0 20px; font-size: 24px; font-weight: 700; text-align: center;">
                      Welcome to BPLO System
                    </h1>
                    
                    <p style="color: #475569; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">
                      Hello <strong>${firstName}</strong>,
                    </p>
                    
                    <p style="color: #475569; font-size: 16px; line-height: 1.6; margin: 0 0 30px;">
                      An administrator has created an account for you. Below are your temporary login credentials.
                    </p>
                    
                    <!-- Credentials Box -->
                    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 30px;">
                      <tr>
                        <td style="padding: 24px;">
                          <table width="100%" border="0" cellspacing="0" cellpadding="0">
                            <tr>
                              <td style="padding-bottom: 12px; color: #64748b; font-size: 14px; font-weight: 600; width: 100px;">Email:</td>
                              <td style="padding-bottom: 12px; color: #0f172a; font-size: 16px;">${email}</td>
                            </tr>
                            <tr>
                              <td style="padding-bottom: 12px; color: #64748b; font-size: 14px; font-weight: 600;">Role:</td>
                              <td style="padding-bottom: 12px; color: #0f172a; font-size: 16px;">
                                <span style="background-color: #e0f2fe; color: #0369a1; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                                  ${roleDisplay}
                                </span>
                              </td>
                            </tr>
                            <tr>
                              <td style="color: #64748b; font-size: 14px; font-weight: 600; vertical-align: middle;">Password:</td>
                              <td style="vertical-align: middle;">
                                <div style="background-color: #ffffff; border: 1px dashed #cbd5e1; padding: 8px 12px; border-radius: 6px; display: inline-block;">
                                  <code style="font-family: 'Courier New', Courier, monospace; font-size: 18px; color: #0F2942; font-weight: 700;">${password}</code>
                                </div>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>

                    <!-- Security Notice -->
                    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #fff7ed; border-left: 4px solid #f97316; margin-bottom: 30px;">
                      <tr>
                        <td style="padding: 16px;">
                          <p style="margin: 0; color: #9a3412; font-size: 14px; line-height: 1.5;">
                            <strong>Security Notice:</strong> This is a temporary password. Please change it immediately after your first login to secure your account.
                          </p>
                        </td>
                      </tr>
                    </table>

                    <p style="color: #64748b; font-size: 15px; line-height: 1.6; margin: 0;">
                      If you have any questions, please contact the system administrator.
                    </p>
                  </td>
                </tr>
                
                <!-- Footer -->
                <tr>
                  <td align="center" style="background-color: #f8fafc; padding: 24px; border-top: 1px solid #e2e8f0;">
                    <p style="color: #94a3b8; font-size: 12px; line-height: 1.5; margin: 0;">
                      <strong>Business Permit and Licensing Office (BPLO)</strong><br>
                      &copy; ${new Date().getFullYear()} All rights reserved.
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
