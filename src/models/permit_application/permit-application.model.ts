import {
  GeneratedPermitSnapshotType,
  InspectionAdminResultType,
  InspectionFlowType,
  InspectionStepType,
  PaymentAssessmentType,
  PermitApplicationDocumentType,
  PermitApplicationFileType,
  PermitApplicationResponseType,
} from "@/types/models/permit-application.type";
import { model, Model, Schema } from "mongoose";

// Store one uploaded file reference from a permit application response.
const PermitApplicationFileSchema = new Schema<PermitApplicationFileType>(
  {
    name: { type: String, required: true, trim: true },
    mimeType: { type: String, required: true, trim: true },
    size: { type: Number, required: true },
    url: { type: String, required: true, trim: true },
  },
  { _id: false },
);

// Store one permit application response field and any uploaded files.
const PermitApplicationResponseSchema =
  new Schema<PermitApplicationResponseType>(
    {
      fieldId: { type: String, required: true, trim: true },
      label: { type: String, required: true, trim: true },
      type: {
        type: String,
        required: true,
        enum: [
          "text",
          "textarea",
          "select",
          "checkbox",
          "radio",
          "date",
          "file",
        ],
      },
      value: { type: Schema.Types.Mixed, required: false, default: null },
      files: {
        type: [PermitApplicationFileSchema],
        required: false,
        default: [],
      },
    },
    { _id: false },
  );

// Store evaluator decision metadata for a routed application.
const EvaluatorProcessDecisionSchema = new Schema(
  {
    processId: { type: String, required: true, trim: true },
    processName: { type: String, required: true, trim: true },
    sequence: { type: Number, required: true },
    notRequired: { type: Boolean, required: true, default: false },
  },
  { _id: false },
);

// Store the evaluator review result and supporting process decisions.
const EvaluatorResultSchema = new Schema(
  {
    evaluator: { type: Schema.Types.ObjectId, ref: "accounts", required: true },
    decision: {
      type: String,
      required: true,
      enum: ["for_inspection", "re_submission", "for_admin_approval"],
    },
    processDecisions: {
      type: [EvaluatorProcessDecisionSchema],
      required: true,
      default: [],
    },
    remark: { type: String, required: false, trim: true, default: "" },
    decidedAt: { type: Date, required: true, default: Date.now },
  },
  { _id: false },
);

// Store the BPLO admin approval result for an application.
const AdminResultSchema = new Schema(
  {
    admin: { type: Schema.Types.ObjectId, ref: "accounts", required: true },
    decision: {
      type: String,
      required: true,
      enum: ["approved", "denied"],
    },
    remark: { type: String, required: false, trim: true, default: "" },
    decidedAt: { type: Date, required: true, default: Date.now },
  },
  { _id: false },
);

// Store the inspector admin result for inspection-stage decisions.
const InspectionAdminResultSchema = new Schema<InspectionAdminResultType>(
  {
    admin: { type: Schema.Types.ObjectId, ref: "accounts", required: true },
    decision: {
      type: String,
      required: true,
      enum: ["approved", "pending", "denied"],
    },
    remark: { type: String, required: false, trim: true, default: "" },
    decidedAt: { type: Date, required: true, default: Date.now },
  },
  { _id: false },
);

// Store one inspection step in the inspection flow.
const InspectionStepSchema = new Schema<InspectionStepType>(
  {
    processId: { type: String, required: true, trim: true },
    processName: { type: String, required: true, trim: true },
    sequence: { type: Number, required: true },
    assignedInspector: {
      type: Schema.Types.ObjectId,
      ref: "accounts",
      required: false,
      default: null,
    },
    assignedInspectorName: {
      type: String,
      required: false,
      trim: true,
      default: "",
    },
    assignedAt: { type: Date, required: false, default: null },
    scheduledInspectionAt: { type: Date, required: false, default: null },
    scheduleStatus: {
      type: String,
      required: true,
      enum: ["unscheduled", "scheduled", "rescheduled"],
      default: "unscheduled",
    },
    scheduleRemark: { type: String, required: false, trim: true, default: "" },
    scheduleUpdatedAt: { type: Date, required: false, default: null },
    assessedScheduleAt: { type: Date, required: false, default: null },
    assessmentResult: {
      type: String,
      required: false,
      enum: ["passed", "for_completion", "failed"],
      default: null,
    },
    assessmentRemark: {
      type: String,
      required: false,
      trim: true,
      default: "",
    },
    assessmentSubmittedAt: { type: Date, required: false, default: null },
    reassessmentRequestedAt: { type: Date, required: false, default: null },
    completedAt: { type: Date, required: false, default: null },
    completionRemark: {
      type: String,
      required: false,
      trim: true,
      default: "",
    },
  },
  { _id: false },
);

// Store the ordered inspection flow for a permit application.
const InspectionFlowSchema = new Schema<InspectionFlowType>(
  {
    currentStepIndex: { type: Number, required: true, default: 0, min: 0 },
    steps: { type: [InspectionStepSchema], required: true, default: [] },
  },
  { _id: false },
);

// Store one payment line item for an application payment assessment.
const PaymentAssessmentItemSchema = new Schema(
  {
    feeName: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

// Store a department payment assessment snapshot tied to an application.
const PaymentAssessmentSchema = new Schema<PaymentAssessmentType>(
  {
    departmentId: { type: String, required: true, trim: true },
    departmentName: { type: String, required: true, trim: true },
    generatedAt: { type: Date, required: true, default: Date.now },
    items: { type: [PaymentAssessmentItemSchema], required: true, default: [] },
    totalAmount: { type: Number, required: true, min: 0, default: 0 },
    paymentStatus: {
      type: String,
      required: true,
      enum: ["pending", "paid"],
      default: "pending",
    },
    statusUpdatedAt: { type: Date, required: false, default: null },
    statusUpdatedBy: {
      type: Schema.Types.ObjectId,
      ref: "accounts",
      required: false,
      default: null,
    },
    statusUpdatedByName: {
      type: String,
      required: false,
      trim: true,
      default: "",
    },
  },
  { _id: false },
);

// Store generated permit document metadata and file payloads.
const GeneratedPermitFileSchema = new Schema(
  {
    fileName: { type: String, required: true, trim: true },
    mimeType: { type: String, required: true, trim: true },
    contentBase64: { type: String, required: true, trim: true },
    generatedAt: { type: Date, required: true, default: Date.now },
    watermarkText: { type: String, required: false, trim: true, default: "" },
    watermarkFontSizePt: {
      type: Number,
      required: false,
      min: 12,
      max: 200,
      default: 48,
    },
    pdf: {
      type: {
        mimeType: { type: String, required: true, trim: true },
        clearContentBase64: { type: String, required: true, trim: true },
        watermarkedContentBase64: { type: String, required: true, trim: true },
        generatedAt: { type: Date, required: true, default: Date.now },
      },
      required: false,
      default: null,
    },
    pageSizeMm: {
      type: {
        width: { type: Number, required: true, min: 10 },
        height: { type: Number, required: true, min: 10 },
      },
      required: false,
      default: null,
    },
  },
  { _id: false },
);

// Store the generated permit snapshot kept on the application record.
const GeneratedPermitSchema = new Schema<GeneratedPermitSnapshotType>(
  {
    templateId: { type: String, required: true, trim: true },
    templateName: { type: String, required: true, trim: true },
    templateVersion: { type: Number, required: true, min: 1 },
    placeholders: { type: [String], required: true, default: [] },
    resolvedValues: {
      type: Map,
      of: String,
      required: true,
      default: {},
    },
    generatedPreview: { type: String, required: true, trim: true, default: "" },
    status: {
      type: String,
      required: true,
      enum: ["generated", "confirmed"],
      default: "generated",
    },
    generatedBy: {
      type: Schema.Types.ObjectId,
      ref: "accounts",
      required: true,
    },
    confirmedBy: {
      type: Schema.Types.ObjectId,
      ref: "accounts",
      required: false,
      default: null,
    },
    confirmedAt: { type: Date, required: false, default: null },
    sentToApplicantBy: {
      type: Schema.Types.ObjectId,
      ref: "accounts",
      required: false,
      default: null,
    },
    sentToApplicantAt: { type: Date, required: false, default: null },
    file: { type: GeneratedPermitFileSchema, required: true },
  },
  { _id: false },
);

// Store the full permit application document and all workflow snapshots.
const PermitApplicationSchema = new Schema<PermitApplicationDocumentType>(
  {
    permit: { type: Schema.Types.ObjectId, ref: "permits", required: true },
    applicant: { type: Schema.Types.ObjectId, ref: "accounts", required: true },
    permitName: { type: String, required: true, trim: true },
    formTitle: { type: String, required: true, trim: true },
    responses: {
      type: [PermitApplicationResponseSchema],
      required: true,
      default: [],
    },
    status: {
      type: String,
      required: true,
      enum: ["submitted", "in_review", "approved", "rejected"],
      default: "submitted",
    },
    tableStatus: {
      type: String,
      required: true,
      enum: ["for_review", "re_submission"],
      default: "for_review",
    },
    currentStage: {
      type: String,
      required: true,
      enum: [
        "evaluator_application_request",
        "admin_inspection_request",
        "inspector_inspection_request",
        "admin_permit_approval",
        "admin_permit_validity",
        "business_owner_application_status",
      ],
      default: "evaluator_application_request",
    },
    destinationModule: {
      type: String,
      required: true,
      enum: [
        "evaluator_application_request",
        "admin_inspection_request",
        "inspector_inspection_request",
        "admin_permit_approval",
        "admin_permit_validity",
        "business_owner_application_status",
      ],
      default: "evaluator_application_request",
    },
    evaluatorResult: {
      type: EvaluatorResultSchema,
      required: false,
    },
    adminResult: {
      type: AdminResultSchema,
      required: false,
    },
    inspectionAdminResult: {
      type: InspectionAdminResultSchema,
      required: false,
    },
    inspectionFlow: {
      type: InspectionFlowSchema,
      required: false,
    },
    paymentAssessments: {
      type: [PaymentAssessmentSchema],
      required: true,
      default: [],
    },
    generatedPermit: {
      type: GeneratedPermitSchema,
      required: false,
      default: null,
    },
    generatedInspectionCertificate: {
      type: GeneratedPermitSchema,
      required: false,
      default: null,
    },
    ownerStatusVersion: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    ownerStatusReadVersion: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    ownerStatusReadAt: {
      type: Date,
      required: false,
      default: null,
    },
    ownerStatusSource: {
      type: String,
      required: true,
      enum: ["system", "evaluator", "bplo_admin", "inspector", "treasurer"],
      default: "system",
    },
    ownerStatusDeletedAt: {
      type: Date,
      required: false,
      default: null,
    },
    submittedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

// Supports evaluator inspection list query:
// decision + stage filters ordered by most recent updates.
PermitApplicationSchema.index({
  "evaluatorResult.decision": 1,
  currentStage: 1,
  updatedAt: -1,
  submittedAt: -1,
});

// Supports inspector inspection request/schedule list queries:
// assigned inspector + stage filters ordered by most recent updates.
PermitApplicationSchema.index({
  "inspectionFlow.steps.assignedInspector": 1,
  currentStage: 1,
  updatedAt: -1,
  submittedAt: -1,
});

// Supports evaluator applicant business-history lookups:
// applicant filter ordered by most recent submissions.
PermitApplicationSchema.index({
  applicant: 1,
  submittedAt: -1,
});

// Register the permit applications collection model.
const PermitApplication: Model<PermitApplicationDocumentType> = model<
  PermitApplicationDocumentType,
  Model<PermitApplicationDocumentType>
>("permit_applications", PermitApplicationSchema);

export default PermitApplication;
