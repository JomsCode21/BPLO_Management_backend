import {
  OWNER_APPLICATIONS_EVENT,
  emitToRole,
  emitToUser,
} from "@/realtime/socket";

type OwnerApplicationStatusUpdatePayload = {
  applicantId: string;
  applicationId: string;
  ownerStatusVersion?: number;
  ownerStatusReadVersion?: number;
  unreadTotal?: number;
  statusSource?:
    | "system"
    | "evaluator"
    | "bplo_admin"
    | "inspector"
    | "treasurer";
};

/**
 * Emits an owner application status update signal to the affected owner.
 * Owner clients should refetch their own status list on this event.
 */
export const emitOwnerApplicationStatusUpdate = (
  payload?: OwnerApplicationStatusUpdatePayload,
) => {
  try {
    const applicantId = String(payload?.applicantId ?? "").trim();

    if (applicantId) {
      emitToUser(applicantId, OWNER_APPLICATIONS_EVENT, payload);
      return;
    }

    emitToRole("business_owner", OWNER_APPLICATIONS_EVENT, payload);
  } catch (error) {
    console.error("Failed to emit owner application status update:", error);
  }
};
