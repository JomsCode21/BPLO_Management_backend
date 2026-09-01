import http from "http";
import { Server, type Socket } from "socket.io";

import { findAccountS } from "@/services/account/account.service";
import type { AccountDocumentType } from "@/types/models/account.type";
import { verifyAccessToken } from "@/utils/jwt/jwt.util";

let io: Server | null = null;

type SocketAccount = Pick<
  AccountDocumentType,
  | "_id"
  | "email"
  | "firstName"
  | "middleName"
  | "lastName"
  | "suffix"
  | "gender"
  | "contactNumber"
  | "profilePictureUrl"
  | "role"
  | "departmentId"
  | "departmentName"
  | "treasurerType"
  | "tokenVersion"
>;

type AuthedSocket = Socket & {
  data: Socket["data"] & {
    account?: SocketAccount | null;
  };
};

const SOCKET_ACCOUNT_SELECT_FIELDS = [
  "email",
  "firstName",
  "middleName",
  "lastName",
  "suffix",
  "gender",
  "contactNumber",
  "profilePictureUrl",
  "role",
  "departmentId",
  "departmentName",
  "treasurerType",
  "tokenVersion",
].join(" ");

const normalizeRole = (value: string) => {
  // Normalize room keys so role-based routing stays consistent.
  return value.trim().toLowerCase();
};

const toSingleHeaderValue = (value: string | string[] | undefined) => {
  // Read a single authorization header value regardless of array form.
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
};

const extractSocketToken = (socket: Socket) => {
  // Extract a bearer token from socket auth payload or headers.
  const authToken = String((socket.handshake.auth as any)?.token ?? "").trim();
  if (authToken) {
    return authToken.startsWith("Bearer ")
      ? authToken.slice("Bearer ".length).trim()
      : authToken;
  }

  const authorizationHeader = toSingleHeaderValue(
    socket.handshake.headers.authorization,
  ).trim();
  if (authorizationHeader.startsWith("Bearer ")) {
    return authorizationHeader.slice("Bearer ".length).trim();
  }

  return "";
};

export const getRoleRoom = (role: string) =>
  // Build the socket room name used for role-based broadcasts.
  `role:${normalizeRole(String(role ?? ""))}`;

export const getUserRoom = (userId: string) =>
  // Build the socket room name used for direct user broadcasts.
  `user:${String(userId ?? "").trim()}`;

const authenticateSocket = async (socket: AuthedSocket) => {
  // Authenticate the socket connection before allowing room joins.
  const token = extractSocketToken(socket);
  if (!token) {
    throw new Error("Unauthorized: Missing access token.");
  }

  const payload = verifyAccessToken(token) as { sub?: string; tv?: number };
  if (!payload?.sub) {
    throw new Error("Unauthorized: Invalid access token.");
  }

  const account = await findAccountS(
    { _id: payload.sub },
    SOCKET_ACCOUNT_SELECT_FIELDS,
  );
  if (!account) {
    throw new Error("Unauthorized: Account not found.");
  }

  const accountTokenVersion =
    typeof account.tokenVersion === "number" ? account.tokenVersion : 0;
  const tokenVersion = typeof payload.tv === "number" ? payload.tv : 0;

  if (accountTokenVersion !== tokenVersion) {
    throw new Error("Unauthorized: Access token is no longer valid.");
  }

  socket.data.account = account as SocketAccount;
  return account as SocketAccount;
};

export const DASHBOARD_STATS_EVENT = "super_admin:dashboard_stats";
export const SUPER_ADMIN_WORKFLOW_AUDIT_EVENT =
  "super_admin:workflow_audit_update";
export const EVALUATOR_APPLICATIONS_EVENT = "evaluator:applications_update";
export const EVALUATOR_INSPECTION_REVIEW_EVENT =
  "evaluator:inspection_review_update";
export const EVALUATOR_DASHBOARD_ANALYTICS_EVENT =
  "evaluator:dashboard_analytics_update";
export const EVALUATOR_WORKFLOW_AUDIT_EVENT = "evaluator:workflow_audit_update";
export const OWNER_APPLICATIONS_EVENT = "owner:applications_update";
export const ADMIN_DASHBOARD_ANALYTICS_EVENT =
  "admin:dashboard_analytics_update";
export const ADMIN_INSPECTION_REQUEST_EVENT = "admin:inspection_request_update";
export const ADMIN_PERMIT_APPROVAL_EVENT = "admin:permit_approval_update";
export const ADMIN_PERMIT_VALIDITY_EVENT = "admin:permit_validity_update";
export const ADMIN_WORKFLOW_AUDIT_EVENT = "admin:workflow_audit_update";
export const INSPECTOR_INSPECTION_REQUEST_EVENT =
  "inspector:inspection_request_update";
export const INSPECTOR_SCHEDULE_EVENT = "inspector:schedule_update";
export const INSPECTOR_WORKFLOW_AUDIT_EVENT = "inspector:workflow_audit_update";
export const DEPARTMENT_TREASURER_PAYMENT_EVENT =
  "department_treasurer:payment_update";
export const MAIN_TREASURER_PAYMENT_EVENT = "main_treasurer:payment_update";
export const DEPARTMENT_TREASURER_WORKFLOW_AUDIT_EVENT =
  "department_treasurer:workflow_audit_update";
export const MAIN_TREASURER_WORKFLOW_AUDIT_EVENT =
  "main_treasurer:workflow_audit_update";

export const initSocket = (server: http.Server, allowedOrigins: string[]) => {
  const normalizeOrigin = (value: string) => {
    // Normalize origins so trailing slashes do not break matching.
    return value.trim().replace(/\/+$/, "");
  };

  console.log("Initializing Socket.IO server...");

  io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(normalizeOrigin(origin))) {
          return callback(null, true);
        }

        callback(new Error("CORS not allowed"), false);
      },
      credentials: true,
    },
  });

  io.use((socket, next) => {
    void authenticateSocket(socket as AuthedSocket)
      .then(() => next())
      .catch((error) =>
        next(
          error instanceof Error
            ? error
            : new Error("Unauthorized: Socket authentication failed."),
        ),
      );
  });

  io.on("connection", (socket) => {
    // Join the socket to role and user rooms after authentication.
    const authedSocket = socket as AuthedSocket;
    const account = authedSocket.data.account;

    if (!account) {
      socket.disconnect(true);
      return;
    }

    const userId = String(account._id ?? "").trim();
    const roleRoom = getRoleRoom(String(account.role ?? ""));
    const rooms = [roleRoom];

    if (userId) {
      rooms.push(getUserRoom(userId));
    }

    socket.join(rooms);
  });

  console.log("Socket.IO server initialized successfully");
  return io;
};

export const getSocket = () => {
  // Return the singleton Socket.IO instance once initialized.
  if (!io) {
    throw new Error("Socket.IO has not been initialized.");
  }

  return io;
};

export const emitToRole = (role: string, event: string, payload?: unknown) => {
  // Emit an event to everyone subscribed to the given role room.
  getSocket().to(getRoleRoom(role)).emit(event, payload);
};

export const emitToUser = (
  userId: string,
  event: string,
  payload?: unknown,
) => {
  // Emit an event directly to one authenticated user room.
  getSocket().to(getUserRoom(userId)).emit(event, payload);
};
