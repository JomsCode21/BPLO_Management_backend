import {
  ADMIN_DASHBOARD_ANALYTICS_EVENT,
  ADMIN_INSPECTION_REQUEST_EVENT,
  ADMIN_PERMIT_APPROVAL_EVENT,
  ADMIN_PERMIT_VALIDITY_EVENT,
  ADMIN_WORKFLOW_AUDIT_EVENT,
  DEPARTMENT_TREASURER_PAYMENT_EVENT,
  DEPARTMENT_TREASURER_WORKFLOW_AUDIT_EVENT,
  INSPECTOR_INSPECTION_REQUEST_EVENT,
  INSPECTOR_SCHEDULE_EVENT,
  INSPECTOR_WORKFLOW_AUDIT_EVENT,
  MAIN_TREASURER_PAYMENT_EVENT,
  MAIN_TREASURER_WORKFLOW_AUDIT_EVENT,
  SUPER_ADMIN_WORKFLOW_AUDIT_EVENT,
  emitToRole,
} from "@/realtime/socket";
import * as RoutedApplicationService from "@/services/bplo-admin/bplo-admin.service";
import * as PaymentAssessmentService from "@/services/main-treasurer/main-treasurer.service";

// Refreshes and emits BPLO admin dashboard analytics.
export const emitAdminDashboardAnalytics = async () => {
  try {
    const analytics =
      await RoutedApplicationService.getBploDashboardAnalyticsS();
    emitToRole("bplo_admin", ADMIN_DASHBOARD_ANALYTICS_EVENT, analytics);
  } catch (error) {
    console.error("Failed to emit BPLO dashboard analytics:", error);
  }
};

// Refreshes and emits applications currently queued for admin inspection routing.
export const emitAdminInspectionRequestApplications = async () => {
  try {
    const applications =
      await RoutedApplicationService.getRoutedApplicationsByDecisionS(
        "for_inspection",
      );
    emitToRole("bplo_admin", ADMIN_INSPECTION_REQUEST_EVENT, applications);
  } catch (error) {
    console.error("Failed to emit inspection request applications:", error);
  }
};

// Refreshes and emits applications currently queued for permit approval.
export const emitAdminPermitApprovalApplications = async () => {
  try {
    const applications =
      await RoutedApplicationService.getRoutedApplicationsByDecisionS(
        "for_admin_approval",
      );
    emitToRole("bplo_admin", ADMIN_PERMIT_APPROVAL_EVENT, applications);
  } catch (error) {
    console.error("Failed to emit permit approval applications:", error);
  }
};

// Refreshes and emits permit validity records for BPLO admin monitoring.
export const emitAdminPermitValidityApplications = async () => {
  try {
    const applications =
      await RoutedApplicationService.getPermitValidityApplicationsS();
    emitToRole("bplo_admin", ADMIN_PERMIT_VALIDITY_EVENT, applications);
  } catch (error) {
    console.error("Failed to emit permit validity applications:", error);
  }
};

// Emits a lightweight update signal for inspector inspection request screens.
export const emitInspectorInspectionRequestApplications = async () => {
  try {
    emitToRole("inspector", INSPECTOR_INSPECTION_REQUEST_EVENT, {
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to emit inspector inspection request update:", error);
  }
};

// Emits a lightweight update signal for inspector schedules.
export const emitInspectorSchedules = async () => {
  try {
    emitToRole("inspector", INSPECTOR_SCHEDULE_EVENT, {
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to emit inspector schedule update:", error);
  }
};

// Emits a workflow audit refresh signal to super admins.
export const emitSuperAdminWorkflowAudit = async () => {
  try {
    emitToRole("super_admin", SUPER_ADMIN_WORKFLOW_AUDIT_EVENT, {
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to emit super admin workflow audit update:", error);
  }
};

// Emits a workflow audit refresh signal to BPLO admins.
export const emitAdminWorkflowAudit = async () => {
  try {
    emitToRole("bplo_admin", ADMIN_WORKFLOW_AUDIT_EVENT, {
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to emit BPLO admin workflow audit update:", error);
  }
};

// Emits a workflow audit refresh signal to inspectors.
export const emitInspectorWorkflowAudit = async () => {
  try {
    emitToRole("inspector", INSPECTOR_WORKFLOW_AUDIT_EVENT, {
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to emit inspector workflow audit update:", error);
  }
};

// Emits a payment list refresh signal to department treasurers.
export const emitDepartmentTreasurerPayments = async () => {
  try {
    emitToRole("department_treasurer", DEPARTMENT_TREASURER_PAYMENT_EVENT, {
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to emit department treasurer payment update:", error);
  }
};

// Refreshes and emits the full payment dataset for main treasurers.
export const emitMainTreasurerPayments = async () => {
  try {
    const payments = await PaymentAssessmentService.getMainTreasurerPaymentsS();
    emitToRole("main_treasurer", MAIN_TREASURER_PAYMENT_EVENT, payments);
  } catch (error) {
    console.error("Failed to emit main treasurer payment update:", error);
  }
};

// Emits a workflow audit refresh signal to department treasurers.
export const emitDepartmentTreasurerWorkflowAudit = async () => {
  try {
    emitToRole(
      "department_treasurer",
      DEPARTMENT_TREASURER_WORKFLOW_AUDIT_EVENT,
      {
        updatedAt: new Date().toISOString(),
      },
    );
  } catch (error) {
    console.error(
      "Failed to emit department treasurer workflow audit update:",
      error,
    );
  }
};

// Emits a workflow audit refresh signal to main treasurers.
export const emitMainTreasurerWorkflowAudit = async () => {
  try {
    emitToRole("main_treasurer", MAIN_TREASURER_WORKFLOW_AUDIT_EVENT, {
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      "Failed to emit main treasurer workflow audit update:",
      error,
    );
  }
};

// Fan-outs all routed-application related updates across affected roles.
export const emitAllAdminRoutedApplications = async () => {
  await Promise.all([
    emitSuperAdminWorkflowAudit(),
    emitAdminWorkflowAudit(),
    emitAdminDashboardAnalytics(),
    emitAdminInspectionRequestApplications(),
    emitAdminPermitApprovalApplications(),
    emitAdminPermitValidityApplications(),
    emitInspectorWorkflowAudit(),
    emitInspectorInspectionRequestApplications(),
    emitInspectorSchedules(),
    emitDepartmentTreasurerWorkflowAudit(),
    emitDepartmentTreasurerPayments(),
    emitMainTreasurerWorkflowAudit(),
    emitMainTreasurerPayments(),
  ]);
};
