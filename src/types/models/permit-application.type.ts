import { Document, Types } from "mongoose";
import { PermitFieldType } from "./permit.type";

// Represents an uploaded file attached to a permit application response.
export type PermitApplicationFileType = {
  name: string;
  mimeType: string;
  size: number;
  url: string;
};

// Represents one response row submitted for a permit field.
export type PermitApplicationResponseType = {
  fieldId: string;
  label: string;
  type: PermitFieldType;
  value?: string | string[] | null;
  files?: PermitApplicationFileType[];
};

// Represents generated permit file payloads and optional PDF variants.
export type GeneratedPermitFileType = {
  fileName: string;
  mimeType: string;
  contentBase64: string;
  generatedAt: Date;
  watermarkText?: string;
  watermarkFontSizePt?: number;
  pdf?: {
    mimeType: string;
    clearContentBase64: string;
    watermarkedContentBase64: string;
    generatedAt: Date;
  } | null;
  pageSizeMm?: {
    width: number;
    height: number;
  } | null;
};

// Represents generated document snapshot metadata stored on applications.
export type GeneratedPermitSnapshotType = {
  templateId: string;
  templateName: string;
  templateVersion: number;
  placeholders: string[];
  resolvedValues: Record<string, string>;
  generatedPreview: string;
  status: "generated" | "confirmed";
  generatedBy: Types.ObjectId;
  confirmedBy?: Types.ObjectId | null;
  confirmedAt?: Date | null;
  sentToApplicantBy?: Types.ObjectId | null;
  sentToApplicantAt?: Date | null;
  file: GeneratedPermitFileType;
};

// Enumerates evaluator outcomes after application review.
export type EvaluatorDecisionType =
  | "for_inspection"
  | "re_submission"
  | "for_admin_approval";

// Enumerates modules/stages that an application can route through.
export type ApplicationModuleStageType =
  | "evaluator_application_request"
  | "admin_inspection_request"
  | "inspector_inspection_request"
  | "admin_permit_approval"
  | "admin_permit_validity"
  | "business_owner_application_status";

// Enumerates BPLO admin final approval outcomes.
export type AdminDecisionType = "approved" | "denied";
// Enumerates BPLO inspection admin decision outcomes.
export type InspectionAdminDecisionType = "approved" | "pending" | "denied";
// Enumerates inspector assessment outcomes for a step.
export type InspectionAssessmentResultType =
  | "passed"
  | "for_completion"
  | "failed";

// Represents evaluator decisions for required/optional process steps.
export type EvaluatorProcessDecisionType = {
  processId: string;
  processName: string;
  sequence: number;
  notRequired: boolean;
};

// Represents evaluator decision metadata stored on the application.
export type EvaluatorResultType = {
  evaluator: Types.ObjectId;
  decision: EvaluatorDecisionType;
  processDecisions: EvaluatorProcessDecisionType[];
  remark?: string;
  decidedAt: Date;
};

// Represents BPLO admin permit-approval decision metadata.
export type AdminResultType = {
  admin: Types.ObjectId;
  decision: AdminDecisionType;
  remark?: string;
  decidedAt: Date;
};

// Represents BPLO admin inspection-routing decision metadata.
export type InspectionAdminResultType = {
  admin: Types.ObjectId;
  decision: InspectionAdminDecisionType;
  remark?: string;
  decidedAt: Date;
};

// Represents one inspection workflow step and its lifecycle fields.
export type InspectionStepType = {
  processId: string;
  processName: string;
  sequence: number;
  assignedInspector?: Types.ObjectId | null;
  assignedInspectorName?: string;
  assignedAt?: Date | null;
  scheduledInspectionAt?: Date | null;
  scheduleStatus?: "unscheduled" | "scheduled" | "rescheduled";
  scheduleRemark?: string;
  scheduleUpdatedAt?: Date | null;
  assessedScheduleAt?: Date | null;
  assessmentResult?: InspectionAssessmentResultType | null;
  assessmentRemark?: string;
  assessmentSubmittedAt?: Date | null;
  reassessmentRequestedAt?: Date | null;
  completedAt?: Date | null;
  completionRemark?: string;
};

// Represents ordered inspection flow progress for an application.
export type InspectionFlowType = {
  currentStepIndex: number;
  steps: InspectionStepType[];
};

// Represents one payable fee item in an assessment.
export type PaymentAssessmentItemType = {
  feeName: string;
  amount: number;
};

// Represents payment assessment totals and payment tracking fields.
export type PaymentAssessmentType = {
  departmentId: string;
  departmentName: string;
  generatedAt: Date;
  items: PaymentAssessmentItemType[];
  totalAmount: number;
  paymentStatus: "pending" | "paid";
  statusUpdatedAt?: Date | null;
  statusUpdatedBy?: Types.ObjectId | null;
  statusUpdatedByName?: string;
};

// Enumerates modules that can publish owner status updates.
export type OwnerStatusSourceType =
  | "system"
  | "evaluator"
  | "bplo_admin"
  | "inspector"
  | "treasurer";

// Represents the full permit application model shape.
export type PermitApplicationType = {
  _id: string;
  permit: Types.ObjectId;
  applicant: Types.ObjectId;
  permitName: string;
  formTitle: string;
  responses: PermitApplicationResponseType[];
  status: "submitted" | "in_review" | "approved" | "rejected";
  tableStatus: "for_review" | "re_submission";
  currentStage: ApplicationModuleStageType;
  destinationModule: ApplicationModuleStageType;
  evaluatorResult?: EvaluatorResultType;
  adminResult?: AdminResultType;
  inspectionAdminResult?: InspectionAdminResultType;
  inspectionFlow?: InspectionFlowType;
  paymentAssessments?: PaymentAssessmentType[];
  generatedPermit?: GeneratedPermitSnapshotType | null;
  generatedInspectionCertificate?: GeneratedPermitSnapshotType | null;
  ownerStatusVersion?: number;
  ownerStatusReadVersion?: number;
  ownerStatusReadAt?: Date | null;
  ownerStatusSource?: OwnerStatusSourceType;
  ownerStatusDeletedAt?: Date | null;
  submittedAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
};

// Represents a hydrated mongoose permit application document.
export type PermitApplicationDocumentType = PermitApplicationType & Document;
