import { refreshToken } from "@/controllers/token/token.controller";
import { Router } from "express";

export const tokenRouter = Router();

// Rotate the access token using the refresh cookie.
tokenRouter.post("/refresh", refreshToken);
