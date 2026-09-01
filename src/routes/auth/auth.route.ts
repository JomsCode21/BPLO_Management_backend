import {
  changePassword,
  forgotPassword,
  getCurrentUser,
  googleAuth,
  login,
  logout,
  register,
  resetPassword,
  updateProfile,
  verifyCurrentPassword,
  verifyForgotPasswordOtp,
  verifyRegistration,
} from "@/controllers/auth/auth.controller";
import { requireAccessToken } from "@/middlewares/token.middleware";
import { Router } from "express";

export const authRouter = Router();

// Registration and password recovery routes.
authRouter.post("/verify-registration", verifyRegistration);
authRouter.post("/verify-otp", verifyForgotPasswordOtp);
authRouter.post("/reset-password", resetPassword);
authRouter.post("/forgot-password", forgotPassword);
authRouter.post("/google", googleAuth);
authRouter.post("/register", register);
authRouter.post("/login", login);

// Authenticated account profile routes.
authRouter.get("/me", requireAccessToken, getCurrentUser);
authRouter.patch("/me", requireAccessToken, updateProfile);
authRouter.post(
  "/verify-current-password",
  requireAccessToken,
  verifyCurrentPassword,
);
authRouter.patch("/change-password", requireAccessToken, changePassword);

// End the current session and clear cookies.
authRouter.post("/logout", logout);
