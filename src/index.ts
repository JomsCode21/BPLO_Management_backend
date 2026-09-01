import dotenv from "dotenv";

dotenv.config();

// Libraries
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import http from "http";
import morgan from "morgan";
// Database
import initDB from "@/db/db.connect.js";
import { serverEnv } from "@/env/server";
import { globalErrorHandler } from "@/middlewares/global-error-handler.middleware";
import { globalRateLimiter } from "@/middlewares/limiter.middleware";
import { initSocket } from "@/realtime/socket";
import { authRouter } from "@/routes/auth/auth.route";
import bploAdminRouter from "@/routes/bplo-admin/bplo-admin.route";
import departmentTreasurerRouter from "@/routes/department-treasurer/department-treasurer.route";
import evaluatorRouter from "@/routes/evaluator/evaluator.route";
import inspectorRouter from "@/routes/inspector/inspector.route";
import mainTreasurerRouter from "@/routes/main-treasurer/main-treasurer.route";
import ownerRouter from "@/routes/owner/owner.route";
import superAdminRouter from "@/routes/super_admin/super_admin.route";
import { tokenRouter } from "@/routes/token/token.route";
import { seedSuperAdminFromEnv } from "@/services/account/seed-super-admin.service";
import mongoSanitize from "@/utils/sanitizer/mongo-sanitizer";

// Bootstraps the HTTP server, middleware stack, routes, sockets, and DB.
const bootstrap = async () => {
  const app = express();

  const { PORT, allowedOrigins, isProduction } = serverEnv;

  app.set("trust proxy", isProduction ? 2 : false);

  // CORS
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        // Normalize origins before comparing against the allow list.
        const normalizeOrigin = (value: string) =>
          value.trim().replace(/\/+$/, "");
        if (allowedOrigins.includes(normalizeOrigin(origin))) {
          return callback(null, true);
        }

        // Reject everything else
        callback(new Error("CORS not allowed"), false);
      },
      credentials: true,
    }),
  );

  // Security headers
  app.use(helmet());

  // Rate limiting
  app.use(globalRateLimiter);

  // Logger
  app.use(morgan("dev"));

  // JSON parser
  app.use(express.json({ limit: "15mb" }));

  // Cookie parser
  app.use(cookieParser());

  // MongoDB sanitizer
  app.use(mongoSanitize);

  // Test api
  app.get("/api/test", (req, res) => {
    res.status(200).send("This is BPLO Backend API v1.0");
  });

  // Routes
  app.use("/api/auth", authRouter);
  app.use("/api/token", tokenRouter);
  app.use("/api/super-admin", superAdminRouter);
  app.use("/api/bplo-admin", bploAdminRouter);
  app.use("/api/inspector", inspectorRouter);
  app.use("/api/department-treasurer", departmentTreasurerRouter);
  app.use("/api/main-treasurer", mainTreasurerRouter);
  app.use("/api/owner", ownerRouter);
  app.use("/api/evaluator", evaluatorRouter);
  // 404 handler: Invalid route
  app.use((req, res) => {
    res.status(404).json({
      message: "Route Not Found",
      path: req.originalUrl,
      method: req.method,
    });
  });

  // Error handler
  app.use(globalErrorHandler);

  const server = http.createServer(app);
  server.setTimeout(300000);

  initSocket(server, allowedOrigins);

  await initDB();
  await seedSuperAdminFromEnv();

  server.listen(PORT, () => {
    console.log(`Server Running on port ${PORT}`);
  });
};

bootstrap().catch((e) => {
  console.error("Fatal boot error:", e);
  process.exit(1);
});
