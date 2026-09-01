import { Document, model, Model, Schema, Types } from "mongoose";

export type OwnerApplicationStatusSourceType =
  | "system"
  | "evaluator"
  | "bplo_admin"
  | "inspector"
  | "treasurer";

export type OwnerApplicationStatusCode =
  | "submitted"
  | "for_inspection"
  | "inspection_pending"
  | "inspection_approved"
  | "inspection_scheduled"
  | "inspection_rescheduled"
  | "inspection_denied"
  | "inspection_passed"
  | "inspection_for_completion"
  | "inspection_failed"
  | "for_admin_approval"
  | "payment_breakdown"
  | "payment_pending"
  | "payment_paid"
  | "payment_confirmed"
  | "re_submission"
  | "approved"
  | "failed";

export type OwnerApplicationStatusType = {
  _id: string;
  permit: Types.ObjectId;
  application: Types.ObjectId;
  applicant: Types.ObjectId;
  permitName: string;
  status: OwnerApplicationStatusCode;
  statusSource: OwnerApplicationStatusSourceType;
  evaluatorRemark?: string;
  adminRemark?: string;
  inspectionRemark?: string;
  inspectionScheduledAt?: Date | null;
  paymentAssessmentSnapshot?: Array<{
    departmentId: string;
    departmentName: string;
    generatedAt?: Date | null;
    items: Array<{
      feeName: string;
      amount: number;
    }>;
    totalAmount: number;
    paymentStatus: "pending" | "paid";
    statusUpdatedAt?: Date | null;
    statusUpdatedByName?: string;
  }>;
  isRead: boolean;
  deletedAt?: Date | null;
  submittedAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
};

export type OwnerApplicationStatusDocumentType = OwnerApplicationStatusType &
  Document;

// Store owner-facing application status history and notification snapshots.
const OwnerApplicationStatusSchema =
  new Schema<OwnerApplicationStatusDocumentType>(
    {
      permit: {
        type: Schema.Types.ObjectId,
        ref: "permits",
        required: true,
        index: true,
      },
      application: {
        type: Schema.Types.ObjectId,
        ref: "permit_applications",
        required: true,
        index: true,
      },
      applicant: {
        type: Schema.Types.ObjectId,
        ref: "accounts",
        required: true,
        index: true,
      },
      permitName: {
        type: String,
        required: true,
        trim: true,
      },
      status: {
        type: String,
        required: true,
        enum: [
          "submitted",
          "for_inspection",
          "inspection_pending",
          "inspection_approved",
          "inspection_scheduled",
          "inspection_rescheduled",
          "inspection_denied",
          "inspection_passed",
          "inspection_for_completion",
          "inspection_failed",
          "for_admin_approval",
          "payment_breakdown",
          "payment_pending",
          "payment_paid",
          "payment_confirmed",
          "re_submission",
          "approved",
          "failed",
        ],
        index: true,
      },
      statusSource: {
        type: String,
        required: true,
        enum: ["system", "evaluator", "bplo_admin", "inspector", "treasurer"],
        default: "system",
      },
      evaluatorRemark: {
        type: String,
        required: false,
        trim: true,
        default: null,
      },
      adminRemark: {
        type: String,
        required: false,
        trim: true,
        default: null,
      },
      inspectionRemark: {
        type: String,
        required: false,
        trim: true,
        default: null,
      },
      inspectionScheduledAt: {
        type: Date,
        required: false,
        default: null,
      },
      paymentAssessmentSnapshot: {
        type: [
          new Schema(
            {
              departmentId: {
                type: String,
                required: true,
                trim: true,
              },
              departmentName: {
                type: String,
                required: true,
                trim: true,
              },
              generatedAt: {
                type: Date,
                required: false,
                default: null,
              },
              items: {
                type: [
                  new Schema(
                    {
                      feeName: {
                        type: String,
                        required: true,
                        trim: true,
                      },
                      amount: {
                        type: Number,
                        required: true,
                        min: 0,
                        default: 0,
                      },
                    },
                    { _id: false },
                  ),
                ],
                required: true,
                default: [],
              },
              totalAmount: {
                type: Number,
                required: true,
                min: 0,
                default: 0,
              },
              paymentStatus: {
                type: String,
                required: true,
                enum: ["pending", "paid"],
                default: "pending",
              },
              statusUpdatedAt: {
                type: Date,
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
          ),
        ],
        required: false,
        default: [],
      },
      isRead: {
        type: Boolean,
        required: true,
        default: false,
        index: true,
      },
      deletedAt: {
        type: Date,
        required: false,
        default: null,
      },
      submittedAt: {
        type: Date,
        required: true,
        default: Date.now,
      },
    },
    { timestamps: true },
  );

// Support owner timeline and notification lookups by applicant and application.
OwnerApplicationStatusSchema.index({ applicant: 1, createdAt: -1 });
OwnerApplicationStatusSchema.index({ application: 1, createdAt: -1 });
OwnerApplicationStatusSchema.index({ deletedAt: 1, createdAt: -1, _id: -1 });
OwnerApplicationStatusSchema.index({
  deletedAt: 1,
  statusSource: 1,
  status: 1,
  createdAt: -1,
  _id: -1,
});
OwnerApplicationStatusSchema.index({
  deletedAt: 1,
  statusSource: 1,
  status: 1,
  application: 1,
  createdAt: -1,
});

// Register the owner application status collection model.
const OwnerApplicationStatus: Model<OwnerApplicationStatusDocumentType> =
  model<OwnerApplicationStatusDocumentType>(
    "owner_application_statuses",
    OwnerApplicationStatusSchema,
  );

export default OwnerApplicationStatus;
