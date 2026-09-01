import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

import dotenv from "dotenv";
import { OAuth2Client } from "google-auth-library";
import mongoose from "mongoose";
import nodemailer from "nodemailer";

type JsonValue = Record<string, any> | any[] | string | number | boolean | null;

type SentEmail = {
  to?: string;
  subject?: string;
  text?: string;
  html?: string;
};

type ApiResponse = {
  status: number;
  body: JsonValue;
};

const REGISTRATION_SUBJECT = "Verify Your Email - BPLO System Registration";
const FORGOT_PASSWORD_SUBJECT = "BPLO Account Security: Your OTP Code";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const RECAPTCHA_VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";
const GOOGLE_TEST_TOKEN = "auth-regression-google-token";
const RECAPTCHA_TEST_TOKEN = "auth-regression-recaptcha-token";

process.env.NODE_ENV = "test";
dotenv.config({
  path: path.resolve(process.cwd(), ".env"),
});

// Seed required test environment variables when values are missing.
const setEnvDefault = (key: string, fallback: string) => {
  process.env[key] = process.env[key]?.trim() || fallback;
};

setEnvDefault("PORT", "5001");
setEnvDefault("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173");
setEnvDefault("MONGO_DB_URI", "mongodb://127.0.0.1:27017/bplo_auth_regression");
setEnvDefault("JWT_ACCESS_TOKEN", "auth-regression-access-secret");
setEnvDefault("JWT_REFRESH_TOKEN", "auth-regression-refresh-secret");
setEnvDefault("GOOGLE_CLIENT_ID", "auth-regression-google-client-id");
setEnvDefault("REFRESH_COOKIE_NAME", "bplo_refresh");
setEnvDefault("REFRESH_COOKIE_PATH", "/");
setEnvDefault("GLOBAL_RATE_LIMIT_MINUTES", "15");
setEnvDefault("GLOBAL_RATE_LIMIT_MAX", "100");
setEnvDefault("RECAPTCHA_SECRET_KEY", "auth-regression-recaptcha-secret");
setEnvDefault("MAIL_HOST", "smtp.gmail.com");
setEnvDefault("MAIL_PORT", "465");
setEnvDefault("MAIL", "noreply@example.com");
setEnvDefault("MAIL_PASSWORD", "auth-regression-mail-password");
setEnvDefault("SEED_SUPER_ADMIN", "false");

process.env.GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID?.trim() || "auth-regression-google-client-id";
process.env.VITE_GOOGLE_CLIENT_ID =
  process.env.VITE_GOOGLE_CLIENT_ID?.trim() || process.env.GOOGLE_CLIENT_ID;

const sentEmails: SentEmail[] = [];

const originalCreateTransport = nodemailer.createTransport.bind(nodemailer);
const originalGetTokenInfo = OAuth2Client.prototype.getTokenInfo;
const originalFetch = global.fetch.bind(globalThis);

(nodemailer as any).createTransport = () => ({
  verify(callback?: (error: Error | null) => void) {
    callback?.(null);
  },
  async sendMail(message: SentEmail) {
    sentEmails.push({
      to: String(message.to ?? ""),
      subject: String(message.subject ?? ""),
      text: String(message.text ?? ""),
      html: String(message.html ?? ""),
    });

    return {
      accepted: [message.to ?? ""],
      messageId: `stub-message-${sentEmails.length}`,
    };
  },
});

OAuth2Client.prototype.getTokenInfo = async function getTokenInfoStub(
  accessToken: string,
) {
  if (accessToken !== GOOGLE_TEST_TOKEN) {
    throw new Error("Invalid Google token.");
  }

  return {
    aud: process.env.GOOGLE_CLIENT_ID,
    email: currentFixture.google.email,
    email_verified: true,
    sub: currentFixture.google.googleId,
    user_id: currentFixture.google.googleId,
  } as any;
};

global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

  if (url === RECAPTCHA_VERIFY_URL) {
    return createJsonResponse({ success: true });
  }

  if (url === GOOGLE_USERINFO_URL) {
    const authorization = resolveHeaderValue(input, init, "authorization");

    if (authorization !== `Bearer ${GOOGLE_TEST_TOKEN}`) {
      return createJsonResponse({ error: "Unauthorized" }, 401);
    }

    return createJsonResponse({
      email: currentFixture.google.email,
      email_verified: true,
      given_name: currentFixture.google.firstName,
      family_name: currentFixture.google.lastName,
      picture: currentFixture.google.picture,
      sub: currentFixture.google.googleId,
    });
  }

  return originalFetch(input as any, init);
}) as typeof global.fetch;

// Build a lightweight JSON response for mocked upstream APIs.
const createJsonResponse = (body: JsonValue, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });

// Resolve a header value regardless of whether fetch input is Request or URL.
const resolveHeaderValue = (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  headerName: string,
) => {
  const requestHeaders =
    typeof input === "string" || input instanceof URL
      ? undefined
      : input.headers;
  const headers = new Headers(init?.headers ?? requestHeaders);
  return headers.get(headerName);
};

// Run a named async test case and emit PASS/FAIL output.
const runCase = async (name: string, callback: () => Promise<void>) => {
  try {
    await callback();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
};

const SOCKET_TIMEOUT_MS = 4_000;

// Await successful socket connection within a bounded timeout.
const waitForSocketConnect = async (
  socket: any,
  timeoutMs = SOCKET_TIMEOUT_MS,
) =>
  new Promise<void>((resolve, reject) => {
    if (socket.connected) {
      resolve();
      return;
    }

    const cleanup = () => {
      clearTimeout(timeoutId);
      socket.off("connect", handleConnect);
      socket.off("connect_error", handleConnectError);
    };

    const handleConnect = () => {
      cleanup();
      resolve();
    };

    const handleConnectError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("Socket connection timed out."));
    }, timeoutMs);

    socket.on("connect", handleConnect);
    socket.on("connect_error", handleConnectError);
  });

// Await a socket connect_error and fail if connection succeeds.
const waitForSocketConnectError = async (
  socket: any,
  timeoutMs = SOCKET_TIMEOUT_MS,
) =>
  new Promise<Error>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeoutId);
      socket.off("connect", handleConnect);
      socket.off("connect_error", handleConnectError);
    };

    const handleConnect = () => {
      cleanup();
      reject(new Error("Socket connected unexpectedly."));
    };

    const handleConnectError = (error: Error) => {
      cleanup();
      resolve(error);
    };

    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("Socket connect_error timed out."));
    }, timeoutMs);

    socket.on("connect", handleConnect);
    socket.on("connect_error", handleConnectError);
  });

// Wait for a single socket event payload.
const waitForSocketEvent = async <T = unknown>(
  socket: any,
  eventName: string,
  timeoutMs = SOCKET_TIMEOUT_MS,
) =>
  new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeoutId);
      socket.off(eventName, handleEvent);
    };

    const handleEvent = (payload: T) => {
      cleanup();
      resolve(payload);
    };

    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for socket event '${eventName}'.`));
    }, timeoutMs);

    socket.on(eventName, handleEvent);
  });

// Ensure a socket does not receive an event during the observation window.
const assertSocketDoesNotReceiveEvent = async (
  socket: any,
  eventName: string,
  timeoutMs = 400,
) =>
  new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeoutId);
      socket.off(eventName, handleEvent);
    };

    const handleEvent = (payload: unknown) => {
      cleanup();
      reject(
        new Error(
          `Socket unexpectedly received '${eventName}': ${JSON.stringify(payload)}`,
        ),
      );
    };

    const timeoutId = setTimeout(() => {
      cleanup();
      resolve();
    }, timeoutMs);

    socket.on(eventName, handleEvent);
  });

class TestClient {
  private readonly cookies = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  // Clone the client with the current cookie jar for session continuity tests.
  clone() {
    const clone = new TestClient(this.baseUrl);
    for (const [name, value] of this.cookies.entries()) {
      clone.cookies.set(name, value);
    }
    return clone;
  }

  // Send an HTTP request while preserving auth cookies between calls.
  async request({
    method,
    path: requestPath,
    accessToken,
    body,
  }: {
    method: string;
    path: string;
    accessToken?: string;
    body?: Record<string, unknown>;
  }): Promise<ApiResponse> {
    const headers = new Headers();
    const cookieHeader = this.getCookieHeader();

    if (cookieHeader) {
      headers.set("cookie", cookieHeader);
    }

    if (accessToken) {
      headers.set("authorization", `Bearer ${accessToken}`);
    }

    let payload: string | undefined;
    if (body !== undefined) {
      headers.set("content-type", "application/json");
      payload = JSON.stringify(body);
    }

    const response = await originalFetch(`${this.baseUrl}${requestPath}`, {
      method,
      headers,
      body: payload,
    });

    this.absorbSetCookies(response);

    const rawText = await response.text();
    const parsedBody = rawText ? (JSON.parse(rawText) as JsonValue) : null;

    return {
      status: response.status,
      body: parsedBody,
    };
  }

  // Serialize stored cookies into a request header string.
  private getCookieHeader() {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  // Persist cookies from response Set-Cookie headers.
  private absorbSetCookies(response: Response) {
    const headersWithGetSetCookie = response.headers as Headers & {
      getSetCookie?: () => string[];
    };
    const setCookies =
      typeof headersWithGetSetCookie.getSetCookie === "function"
        ? headersWithGetSetCookie.getSetCookie()
        : [response.headers.get("set-cookie")].filter(
            (value): value is string => Boolean(value),
          );

    for (const setCookie of setCookies) {
      this.storeCookie(setCookie);
    }
  }

  // Upsert or remove a cookie entry based on Set-Cookie attributes.
  private storeCookie(setCookie: string) {
    const segments = setCookie.split(";").map((segment) => segment.trim());
    const [cookiePair, ...attributes] = segments;
    const separatorIndex = cookiePair.indexOf("=");

    if (separatorIndex === -1) {
      return;
    }

    const name = cookiePair.slice(0, separatorIndex);
    const value = cookiePair.slice(separatorIndex + 1);
    const shouldDelete =
      value === "" ||
      attributes.some((attribute) => /^max-age=0$/i.test(attribute)) ||
      attributes.some(
        (attribute) =>
          /^expires=/i.test(attribute) &&
          attribute.toLowerCase().includes("1970"),
      );

    if (shouldDelete) {
      this.cookies.delete(name);
      return;
    }

    this.cookies.set(name, value);
  }
}

// Locate the latest OTP email for the target user and extract its code.
const findOtpEmail = ({
  to,
  subject,
  afterIndex,
}: {
  to: string;
  subject: string;
  afterIndex: number;
}) => {
  for (let index = sentEmails.length - 1; index >= afterIndex; index -= 1) {
    const email = sentEmails[index];

    if (
      email.to?.toLowerCase() === to.toLowerCase() &&
      email.subject === subject
    ) {
      const otpMatch = `${email.text ?? ""}\n${email.html ?? ""}`.match(
        /\b(\d{6})\b/,
      );

      if (!otpMatch) {
        throw new Error(`Failed to extract OTP from email '${subject}'.`);
      }

      return otpMatch[1];
    }
  }

  throw new Error(`No '${subject}' email found for ${to}.`);
};

// Boot a local Express server wired with the auth-related routes under test.
const createServer = async () => {
  const express = (await import("express")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const mongoSanitize = (await import("../utils/sanitizer/mongo-sanitizer"))
    .default;
  const { globalErrorHandler } =
    await import("../middlewares/global-error-handler.middleware");
  const { authRouter } = await import("../routes/auth/auth.route");
  const { tokenRouter } = await import("../routes/token/token.route");
  const ownerRouter = (await import("../routes/owner/owner.route")).default;
  const superAdminRouter = (
    await import("../routes/super_admin/super_admin.route")
  ).default;
  const { initSocket } = await import("../realtime/socket");

  const app = express();

  app.use(express.json({ limit: "15mb" }));
  app.use(cookieParser());
  app.use(mongoSanitize);

  app.use("/api/auth", authRouter);
  app.use("/api/token", tokenRouter);
  app.use("/api/owner", ownerRouter);
  app.use("/api/super-admin", superAdminRouter);

  app.use((req, res) => {
    res.status(404).json({
      message: "Route Not Found",
      method: req.method,
      path: req.originalUrl,
    });
  });

  app.use(globalErrorHandler);

  const server = http.createServer(app);
  initSocket(server, []);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as AddressInfo | null;
  assert.ok(
    address && typeof address.port === "number",
    "Server did not bind.",
  );

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server,
  };
};

// Gracefully stop the temporary regression server.
const closeServer = async (server: http.Server) => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

const currentFixture = {
  owner: {
    email: "",
    password: "OwnerFlow@123",
    resetPassword: "OwnerReset@123",
    changedPassword: "OwnerChanged@123",
  },
  admin: {
    email: "",
    password: "AdminFlow@123",
  },
  google: {
    email: "",
    firstName: "Google",
    lastName: "Regression",
    googleId: "",
    picture: "https://example.com/google-regression.png",
  },
};

// Run the full end-to-end auth regression flow.
const main = async () => {
  const initDB = (await import("../db/db.connect")).default;
  const Account = (await import("../models/account/account.model")).default;
  const OwnerApplicationStatus = (
    await import("../models/owner_application_status/owner-application-status.model")
  ).default;
  const PermitApplication = (
    await import("../models/permit_application/permit-application.model")
  ).default;
  const Permit = (await import("../models/permit/permit.model")).default;
  const { hashValue } = await import("../utils/bcrypt/bcrypt.util");
  const { OWNER_APPLICATIONS_EVENT, SUPER_ADMIN_WORKFLOW_AUDIT_EVENT } =
    await import("../realtime/socket");
  const { emitSuperAdminWorkflowAudit } =
    await import("../utils/admin/emit-routed-applications.util");
  const { emitOwnerApplicationStatusUpdate } =
    await import("../utils/owner/emit-owner-application-status.util");
  const socketIoClientModule = await import(
    pathToFileURL(
      path.resolve(
        process.cwd(),
        "../bplo-frontend/node_modules/socket.io-client/build/cjs/index.js",
      ),
    ).href
  );
  const createSocketClient =
    (socketIoClientModule.io as
      | ((url: string, options?: Record<string, unknown>) => any)
      | undefined) ??
    (socketIoClientModule.default as
      | ((url: string, options?: Record<string, unknown>) => any)
      | undefined);

  assert.ok(createSocketClient, "Socket.IO client module failed to load.");

  const runId = `auth-${Date.now()}`;
  currentFixture.owner.email = `${runId}-owner@example.com`;
  currentFixture.admin.email = `${runId}-admin@example.com`;
  currentFixture.google.email = `${runId}-google@example.com`;
  currentFixture.google.googleId = `${runId}-google-id`;

  let server: http.Server | undefined;

  try {
    await initDB();
    assert.equal(
      mongoose.connection.readyState,
      1,
      "MongoDB connection is required for auth regression tests.",
    );

    await Account.deleteMany({
      email: {
        $in: [
          currentFixture.owner.email,
          currentFixture.admin.email,
          currentFixture.google.email,
        ],
      },
    }).exec();
    await OwnerApplicationStatus.deleteMany({
      permitName: new RegExp(`^${runId}-`, "i"),
    }).exec();
    await PermitApplication.deleteMany({
      permitName: new RegExp(`^${runId}-`, "i"),
    }).exec();
    await Permit.deleteMany({
      name: new RegExp(`^${runId}-`, "i"),
    }).exec();

    await Account.create({
      firstName: "Regression",
      middleName: "",
      lastName: "Admin",
      suffix: "",
      gender: "Prefer not to say",
      email: currentFixture.admin.email,
      password: await hashValue(currentFixture.admin.password),
      role: "super_admin",
      authProvider: "local",
      isVerified: true,
    });

    const runningServer = await createServer();
    server = runningServer.server;

    const ownerClient = new TestClient(runningServer.baseUrl);
    const googleClient = new TestClient(runningServer.baseUrl);
    const adminClient = new TestClient(runningServer.baseUrl);

    let ownerAccessToken = "";
    let refreshedOwnerAccessToken = "";
    let postResetOwnerAccessToken = "";
    let postChangeOwnerAccessToken = "";
    let adminAccessToken = "";
    let googleAccessToken = "";

    await runCase("register", async () => {
      const emailCountBefore = sentEmails.length;

      const response = await ownerClient.request({
        method: "POST",
        path: "/api/auth/register",
        body: {
          firstName: "Auth",
          middleName: "Flow",
          lastName: "Owner",
          suffix: "",
          gender: "Female",
          email: currentFixture.owner.email,
          password: currentFixture.owner.password,
          recaptchaToken: RECAPTCHA_TEST_TOKEN,
        },
      });

      assert.equal(response.status, 200);
      assert.equal((response.body as any).success, true);
      assert.equal((response.body as any).email, currentFixture.owner.email);
      assert.ok(sentEmails.length > emailCountBefore);
    });

    await runCase("verify OTP", async () => {
      const otp = findOtpEmail({
        to: currentFixture.owner.email,
        subject: REGISTRATION_SUBJECT,
        afterIndex: 0,
      });

      const response = await ownerClient.request({
        method: "POST",
        path: "/api/auth/verify-registration",
        body: {
          email: currentFixture.owner.email,
          otp,
        },
      });

      assert.equal(response.status, 200);
      assert.equal((response.body as any).success, true);
      assert.equal(
        (response.body as any).user.email,
        currentFixture.owner.email,
      );
      assert.equal((response.body as any).user.role, "business_owner");
      ownerAccessToken = String((response.body as any).accessToken ?? "");
      assert.ok(ownerAccessToken);
    });

    await runCase("login", async () => {
      const logoutResponse = await ownerClient.request({
        method: "POST",
        path: "/api/auth/logout",
      });

      assert.equal(logoutResponse.status, 200);

      const response = await ownerClient.request({
        method: "POST",
        path: "/api/auth/login",
        body: {
          email: currentFixture.owner.email,
          password: currentFixture.owner.password,
          recaptchaToken: RECAPTCHA_TEST_TOKEN,
        },
      });

      assert.equal(response.status, 200);
      assert.equal(
        (response.body as any).user.email,
        currentFixture.owner.email,
      );
      ownerAccessToken = String((response.body as any).accessToken ?? "");
      assert.ok(ownerAccessToken);
    });

    await runCase("token refresh", async () => {
      const reloadClient = ownerClient.clone();
      const response = await reloadClient.request({
        method: "POST",
        path: "/api/token/refresh",
      });

      assert.equal(response.status, 200);
      refreshedOwnerAccessToken = String(
        (response.body as any).accessToken ?? "",
      );
      assert.ok(refreshedOwnerAccessToken);
    });

    await runCase("reload after refresh", async () => {
      const reloadClient = ownerClient.clone();
      const refreshResponse = await reloadClient.request({
        method: "POST",
        path: "/api/token/refresh",
      });

      assert.equal(refreshResponse.status, 200);
      const accessToken = String(
        (refreshResponse.body as any).accessToken ?? "",
      );
      assert.ok(accessToken);

      const meResponse = await reloadClient.request({
        method: "GET",
        path: "/api/auth/me",
        accessToken,
      });

      assert.equal(meResponse.status, 200);
      assert.equal(
        (meResponse.body as any).user.email,
        currentFixture.owner.email,
      );
    });

    await runCase("protected route access by role", async () => {
      const ownerRoute = await ownerClient.request({
        method: "GET",
        path: "/api/owner/permits",
        accessToken: ownerAccessToken,
      });

      assert.equal(ownerRoute.status, 200);
      assert.equal((ownerRoute.body as any).success, true);

      const forbiddenRoute = await ownerClient.request({
        method: "GET",
        path: "/api/super-admin/dashboard",
        accessToken: ownerAccessToken,
      });

      assert.equal(forbiddenRoute.status, 403);
      assert.match(
        String((forbiddenRoute.body as any).message ?? ""),
        /does not have access/i,
      );
    });

    await runCase("logout", async () => {
      const staleClient = ownerClient.clone();

      const logoutResponse = await ownerClient.request({
        method: "POST",
        path: "/api/auth/logout",
      });

      assert.equal(logoutResponse.status, 200);

      const staleRefreshResponse = await staleClient.request({
        method: "POST",
        path: "/api/token/refresh",
      });

      assert.equal(staleRefreshResponse.status, 200);
      assert.equal((staleRefreshResponse.body as any).accessToken, null);
      assert.match(
        String((staleRefreshResponse.body as any).message ?? ""),
        /login again|session not found/i,
      );
    });

    await runCase("forgot password", async () => {
      const loginResponse = await ownerClient.request({
        method: "POST",
        path: "/api/auth/login",
        body: {
          email: currentFixture.owner.email,
          password: currentFixture.owner.password,
          recaptchaToken: RECAPTCHA_TEST_TOKEN,
        },
      });

      assert.equal(loginResponse.status, 200);
      ownerAccessToken = String((loginResponse.body as any).accessToken ?? "");
      assert.ok(ownerAccessToken);

      const emailCountBefore = sentEmails.length;
      const forgotResponse = await ownerClient.request({
        method: "POST",
        path: "/api/auth/forgot-password",
        body: {
          email: currentFixture.owner.email,
          recaptchaToken: RECAPTCHA_TEST_TOKEN,
        },
      });

      assert.equal(forgotResponse.status, 200);
      assert.equal((forgotResponse.body as any).success, true);
      assert.ok(sentEmails.length > emailCountBefore);
    });

    await runCase("reset password", async () => {
      const otp = findOtpEmail({
        to: currentFixture.owner.email,
        subject: FORGOT_PASSWORD_SUBJECT,
        afterIndex: 0,
      });

      const verifyOtpResponse = await ownerClient.request({
        method: "POST",
        path: "/api/auth/verify-otp",
        body: {
          email: currentFixture.owner.email,
          otp,
        },
      });

      assert.equal(verifyOtpResponse.status, 200);
      assert.equal((verifyOtpResponse.body as any).success, true);

      const staleClient = ownerClient.clone();
      const staleAccessToken = ownerAccessToken;

      const resetResponse = await ownerClient.request({
        method: "POST",
        path: "/api/auth/reset-password",
        body: {
          email: currentFixture.owner.email,
          otp,
          newPassword: currentFixture.owner.resetPassword,
        },
      });

      assert.equal(resetResponse.status, 200);
      assert.equal((resetResponse.body as any).success, true);

      const staleMeResponse = await staleClient.request({
        method: "GET",
        path: "/api/auth/me",
        accessToken: staleAccessToken,
      });

      assert.equal(staleMeResponse.status, 401);

      const staleRefreshResponse = await staleClient.request({
        method: "POST",
        path: "/api/token/refresh",
      });

      assert.equal(staleRefreshResponse.status, 200);
      assert.equal((staleRefreshResponse.body as any).accessToken, null);

      const oldPasswordLogin = await ownerClient.request({
        method: "POST",
        path: "/api/auth/login",
        body: {
          email: currentFixture.owner.email,
          password: currentFixture.owner.password,
          recaptchaToken: RECAPTCHA_TEST_TOKEN,
        },
      });

      assert.equal(oldPasswordLogin.status, 400);

      const newPasswordLogin = await ownerClient.request({
        method: "POST",
        path: "/api/auth/login",
        body: {
          email: currentFixture.owner.email,
          password: currentFixture.owner.resetPassword,
          recaptchaToken: RECAPTCHA_TEST_TOKEN,
        },
      });

      assert.equal(newPasswordLogin.status, 200);
      postResetOwnerAccessToken = String(
        (newPasswordLogin.body as any).accessToken ?? "",
      );
      assert.ok(postResetOwnerAccessToken);
    });

    await runCase("change password", async () => {
      const staleClient = ownerClient.clone();
      const staleAccessToken = postResetOwnerAccessToken;

      const changeResponse = await ownerClient.request({
        method: "PATCH",
        path: "/api/auth/change-password",
        accessToken: postResetOwnerAccessToken,
        body: {
          currentPassword: currentFixture.owner.resetPassword,
          newPassword: currentFixture.owner.changedPassword,
        },
      });

      assert.equal(changeResponse.status, 200);
      assert.equal((changeResponse.body as any).success, true);

      const staleMeResponse = await staleClient.request({
        method: "GET",
        path: "/api/auth/me",
        accessToken: staleAccessToken,
      });

      assert.equal(staleMeResponse.status, 401);

      const staleRefreshResponse = await staleClient.request({
        method: "POST",
        path: "/api/token/refresh",
      });

      assert.equal(staleRefreshResponse.status, 200);
      assert.equal((staleRefreshResponse.body as any).accessToken, null);

      const oldPasswordLogin = await ownerClient.request({
        method: "POST",
        path: "/api/auth/login",
        body: {
          email: currentFixture.owner.email,
          password: currentFixture.owner.resetPassword,
          recaptchaToken: RECAPTCHA_TEST_TOKEN,
        },
      });

      assert.equal(oldPasswordLogin.status, 400);

      const newPasswordLogin = await ownerClient.request({
        method: "POST",
        path: "/api/auth/login",
        body: {
          email: currentFixture.owner.email,
          password: currentFixture.owner.changedPassword,
          recaptchaToken: RECAPTCHA_TEST_TOKEN,
        },
      });

      assert.equal(newPasswordLogin.status, 200);
      postChangeOwnerAccessToken = String(
        (newPasswordLogin.body as any).accessToken ?? "",
      );
      assert.ok(postChangeOwnerAccessToken);
    });

    await runCase("super admin protected route access", async () => {
      const loginResponse = await adminClient.request({
        method: "POST",
        path: "/api/auth/login",
        body: {
          email: currentFixture.admin.email,
          password: currentFixture.admin.password,
          recaptchaToken: RECAPTCHA_TEST_TOKEN,
        },
      });

      assert.equal(loginResponse.status, 200);
      assert.equal((loginResponse.body as any).user.role, "super_admin");
      adminAccessToken = String((loginResponse.body as any).accessToken ?? "");
      assert.ok(adminAccessToken);

      const dashboardResponse = await adminClient.request({
        method: "GET",
        path: "/api/super-admin/dashboard",
        accessToken: adminAccessToken,
      });

      assert.equal(dashboardResponse.status, 200);
      assert.equal((dashboardResponse.body as any).success, true);
    });

    await runCase("socket auth and scoped broadcasts", async () => {
      const ownerAccount = await Account.findOne({
        email: currentFixture.owner.email,
      })
        .select("_id")
        .lean();

      assert.ok(ownerAccount?._id, "Owner account was not created.");
      assert.ok(adminAccessToken, "Super admin access token is required.");
      assert.ok(
        postChangeOwnerAccessToken,
        "Current owner access token is required.",
      );
      assert.ok(
        postResetOwnerAccessToken,
        "Stale owner access token is required.",
      );

      const connectSocket = (accessToken?: string) =>
        createSocketClient(runningServer.baseUrl, {
          autoConnect: false,
          auth: accessToken ? { token: accessToken } : undefined,
          forceNew: true,
          reconnection: false,
          timeout: SOCKET_TIMEOUT_MS,
          transports: ["websocket"],
        });

      const unauthorizedSocket = connectSocket();
      const staleOwnerSocket = connectSocket(postResetOwnerAccessToken);
      const adminSocket = connectSocket(adminAccessToken);
      const ownerSocket = connectSocket(postChangeOwnerAccessToken);

      try {
        const missingTokenErrorPromise =
          waitForSocketConnectError(unauthorizedSocket);
        unauthorizedSocket.connect();
        const missingTokenError = await missingTokenErrorPromise;
        assert.match(
          String(missingTokenError.message ?? ""),
          /missing access token|unauthorized/i,
        );

        const staleTokenErrorPromise =
          waitForSocketConnectError(staleOwnerSocket);
        staleOwnerSocket.connect();
        const staleTokenError = await staleTokenErrorPromise;
        assert.match(
          String(staleTokenError.message ?? ""),
          /no longer valid|unauthorized/i,
        );

        const adminConnected = waitForSocketConnect(adminSocket);
        const ownerConnected = waitForSocketConnect(ownerSocket);
        adminSocket.connect();
        ownerSocket.connect();
        await Promise.all([adminConnected, ownerConnected]);

        const superAdminAuditEvent = waitForSocketEvent<{
          updatedAt?: string;
        }>(adminSocket, SUPER_ADMIN_WORKFLOW_AUDIT_EVENT);
        const ownerShouldNotReceiveAdminEvent = assertSocketDoesNotReceiveEvent(
          ownerSocket,
          SUPER_ADMIN_WORKFLOW_AUDIT_EVENT,
        );

        await emitSuperAdminWorkflowAudit();

        const adminAuditPayload = await superAdminAuditEvent;
        assert.ok(adminAuditPayload.updatedAt);
        await ownerShouldNotReceiveAdminEvent;

        const ownerApplicationsEvent = waitForSocketEvent<{
          applicantId?: string;
          applicationId?: string;
        }>(ownerSocket, OWNER_APPLICATIONS_EVENT);
        const adminShouldNotReceiveOwnerEvent = assertSocketDoesNotReceiveEvent(
          adminSocket,
          OWNER_APPLICATIONS_EVENT,
        );

        emitOwnerApplicationStatusUpdate({
          applicantId: String(ownerAccount._id),
          applicationId: `${runId}-socket-application`,
          ownerStatusVersion: 1,
          unreadTotal: 1,
        });

        const ownerPayload = await ownerApplicationsEvent;
        assert.equal(ownerPayload.applicantId, String(ownerAccount._id));
        assert.equal(ownerPayload.applicationId, `${runId}-socket-application`);
        await adminShouldNotReceiveOwnerEvent;
      } finally {
        unauthorizedSocket.disconnect();
        staleOwnerSocket.disconnect();
        adminSocket.disconnect();
        ownerSocket.disconnect();
      }
    });

    await runCase(
      "super admin workflow audit returns full event history",
      async () => {
        const ownerAccount = await Account.findOne({
          email: currentFixture.owner.email,
        })
          .select("_id")
          .lean();
        const adminAccount = await Account.findOne({
          email: currentFixture.admin.email,
        })
          .select("_id")
          .lean();

        assert.ok(ownerAccount?._id, "Owner account was not created.");
        assert.ok(adminAccount?._id, "Super admin account was not created.");

        const permit = await Permit.create({
          name: `${runId}-audit-permit`,
          description: "Auth regression super admin audit permit",
          formTitle: `${runId}-audit-permit`,
          formDescription: "Audit regression form",
          sections: [],
          fields: [],
        });

        const application = await PermitApplication.create({
          permit: permit._id,
          applicant: ownerAccount._id,
          permitName: permit.name,
          formTitle: permit.name,
          responses: [],
          status: "approved",
          tableStatus: "for_review",
          currentStage: "admin_permit_validity",
          destinationModule: "admin_permit_validity",
          ownerStatusVersion: 2,
          ownerStatusReadVersion: 0,
          ownerStatusSource: "system",
          submittedAt: new Date("2026-01-03T08:00:00.000Z"),
        });

        const submittedStatus = await OwnerApplicationStatus.create({
          permit: permit._id,
          application: application._id,
          applicant: ownerAccount._id,
          permitName: permit.name,
          status: "submitted",
          statusSource: "system",
          adminRemark: `${runId} submitted for review`,
          isRead: false,
          submittedAt: new Date("2026-01-03T08:00:00.000Z"),
        });

        const approvedStatus = await OwnerApplicationStatus.create({
          permit: permit._id,
          application: application._id,
          applicant: ownerAccount._id,
          permitName: permit.name,
          status: "approved",
          statusSource: "system",
          adminRemark: `${runId} permit released`,
          isRead: false,
          submittedAt: new Date("2026-01-03T12:00:00.000Z"),
        });

        assert.ok(submittedStatus._id);
        assert.ok(approvedStatus._id);

        const auditResponse = await adminClient.request({
          method: "GET",
          path: `/api/super-admin/audit/workflow?search=${encodeURIComponent(permit.name)}`,
          accessToken: adminAccessToken,
        });

        assert.equal(auditResponse.status, 200);
        assert.equal((auditResponse.body as any).success, true);

        const auditRows = ((auditResponse.body as any).data ?? []).filter(
          (row: any) => row.applicationId === String(application._id),
        );

        assert.equal(auditRows.length, 2);
        assert.deepEqual(
          auditRows.map((row: any) => row.statusCode),
          ["approved", "submitted"],
        );
        assert.deepEqual(
          auditRows.map((row: any) => row.remark),
          [`${runId} permit released`, `${runId} submitted for review`],
        );

        const searchResponse = await adminClient.request({
          method: "GET",
          path: `/api/super-admin/audit/workflow?search=${encodeURIComponent(`${runId} submitted for review`)}`,
          accessToken: adminAccessToken,
        });

        assert.equal(searchResponse.status, 200);
        assert.equal((searchResponse.body as any).success, true);
        assert.equal((searchResponse.body as any).pagination.total, 1);
        assert.deepEqual(
          ((searchResponse.body as any).data ?? []).map(
            (row: any) => row.statusCode,
          ),
          ["submitted"],
        );
      },
    );

    await runCase("Google login", async () => {
      const response = await googleClient.request({
        method: "POST",
        path: "/api/auth/google",
        body: {
          token: GOOGLE_TEST_TOKEN,
          recaptchaToken: RECAPTCHA_TEST_TOKEN,
        },
      });

      assert.equal(response.status, 200);
      assert.equal(
        (response.body as any).user.email,
        currentFixture.google.email,
      );
      assert.equal((response.body as any).user.role, "business_owner");
      googleAccessToken = String((response.body as any).accessToken ?? "");
      assert.ok(googleAccessToken);

      const meResponse = await googleClient.request({
        method: "GET",
        path: "/api/auth/me",
        accessToken: googleAccessToken,
      });

      assert.equal(meResponse.status, 200);
      assert.equal(
        (meResponse.body as any).user.email,
        currentFixture.google.email,
      );
    });

    await runCase("Google account password reset guard", async () => {
      const response = await googleClient.request({
        method: "POST",
        path: "/api/auth/forgot-password",
        body: {
          email: currentFixture.google.email,
          recaptchaToken: RECAPTCHA_TEST_TOKEN,
        },
      });

      assert.equal(response.status, 400);
      assert.equal((response.body as any).isGoogleAuth, true);
    });

    await runCase("Unverified account forgot password does not send OTP", async () => {
      const unverifiedEmail = `${runId}-unverified@example.com`;

      await Account.create({
        firstName: "Unverified",
        lastName: "User",
        gender: "Prefer not to say",
        email: unverifiedEmail,
        password: await hashValue("UnverifiedFlow@123"),
        role: "business_owner",
        isVerified: false,
      });

      const emailCountBefore = sentEmails.length;
      const response = await ownerClient.request({
        method: "POST",
        path: "/api/auth/forgot-password",
        body: {
          email: unverifiedEmail,
          recaptchaToken: RECAPTCHA_TEST_TOKEN,
        },
      });

      assert.equal(response.status, 403);
      assert.equal((response.body as any).success, false);
      assert.equal((response.body as any).isVerified, false);
      assert.equal(sentEmails.length, emailCountBefore);

      const unverifiedAccount = await Account.findOne({
        email: unverifiedEmail,
      }).lean();
      assert.ok(unverifiedAccount);
      assert.equal(Boolean(unverifiedAccount?.forgotPasswordOtp), false);
      assert.equal(Boolean(unverifiedAccount?.forgotPasswordExpiresAt), false);
    });

    console.log("All auth regression checks passed.");
  } finally {
    try {
      const Account = (await import("../models/account/account.model")).default;
      const OwnerApplicationStatus = (
        await import("../models/owner_application_status/owner-application-status.model")
      ).default;
      const PermitApplication = (
        await import("../models/permit_application/permit-application.model")
      ).default;
      const Permit = (await import("../models/permit/permit.model")).default;
      await Account.deleteMany({
        email: {
          $in: [
            currentFixture.owner.email,
            currentFixture.admin.email,
            currentFixture.google.email,
          ].filter(Boolean),
        },
      }).exec();
      await OwnerApplicationStatus.deleteMany({
        permitName: {
          $regex: new RegExp(`^${runId}-audit-permit$`, "i"),
        },
      }).exec();
      await PermitApplication.deleteMany({
        permitName: {
          $regex: new RegExp(`^${runId}-audit-permit$`, "i"),
        },
      }).exec();
      await Permit.deleteMany({
        name: {
          $regex: new RegExp(`^${runId}-audit-permit$`, "i"),
        },
      }).exec();
    } catch (cleanupError) {
      console.error("Cleanup failed:", cleanupError);
    }

    if (server) {
      await closeServer(server);
    }

    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }

    (nodemailer as any).createTransport = originalCreateTransport;
    OAuth2Client.prototype.getTokenInfo = originalGetTokenInfo;
    global.fetch = originalFetch;
  }
};

main().catch((error) => {
  process.exitCode = 1;
  console.error(error);
});
