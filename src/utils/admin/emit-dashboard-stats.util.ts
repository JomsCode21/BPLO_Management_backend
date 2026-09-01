import * as AdminService from "@/services/super_admin/admin.service";
import { DASHBOARD_STATS_EVENT, emitToRole } from "@/realtime/socket";

/**
 * Fetches current dashboard stats and broadcasts them to all connected clients
 * via Socket.IO. Call this after any operation that changes officer counts
 * (create, delete, role changes, etc.)
 */
export const emitDashboardStats = async () => {
  try {
    const stats = await AdminService.getDashboardData();
    emitToRole("super_admin", DASHBOARD_STATS_EVENT, stats);
  } catch (error) {
    console.error("Failed to emit dashboard stats:", error);
  }
};
