import {
  PermitTemplateAutoIncrementStateType,
  PermitTemplateDocumentType,
  PermitTemplatePlaceholderMappingType,
} from "@/types/models/permit-template.type";
import { model, Model, Schema } from "mongoose";

// Store the auto-increment configuration for a template placeholder.
const PermitTemplateAutoIncrementConfigSchema = new Schema(
  {
    prefix: { type: String, required: false, trim: true, default: "" },
    suffix: { type: String, required: false, trim: true, default: "" },
    paddingLength: {
      type: Number,
      required: true,
      min: 1,
      max: 12,
      default: 4,
    },
    resetRule: {
      type: String,
      required: true,
      enum: ["no_reset", "yearly", "monthly"],
      default: "yearly",
    },
  },
  { _id: false },
);

// Store one placeholder mapping rule for a generated document template.
const PermitTemplateMappingSchema =
  new Schema<PermitTemplatePlaceholderMappingType>(
    {
      placeholder: { type: String, required: true, trim: true },
      label: { type: String, required: false, trim: true, default: "" },
      sourceType: {
        type: String,
        required: true,
        enum: ["system", "field", "fixed_value", "auto_increment"],
      },
      sourceKey: { type: String, required: false, trim: true, default: "" },
      fixedValue: { type: String, required: false, trim: true, default: "" },
      autoIncrement: {
        type: PermitTemplateAutoIncrementConfigSchema,
        required: false,
        default: null,
      },
      confidence: {
        type: String,
        required: true,
        enum: ["high", "medium", "low"],
        default: "low",
      },
      needsReview: { type: Boolean, required: true, default: true },
    },
    { _id: false },
  );

// Store the current state of a template's auto-increment counters.
const PermitTemplateAutoIncrementStateSchema =
  new Schema<PermitTemplateAutoIncrementStateType>(
    {
      placeholder: { type: String, required: true, trim: true },
      lastPeriodKey: { type: String, required: true, trim: true, default: "" },
      currentValue: { type: Number, required: true, min: 0, default: 0 },
      lastAssignedValue: {
        type: String,
        required: false,
        trim: true,
        default: "",
      },
      updatedAt: { type: Date, required: true, default: Date.now },
    },
    { _id: false },
  );

// Store the full permit or certificate template definition.
const PermitTemplateSchema = new Schema<PermitTemplateDocumentType>(
  {
    templateScope: {
      type: String,
      required: true,
      enum: ["permit", "inspection_certificate"],
      default: "permit",
      index: true,
    },
    name: { type: String, required: true, trim: true },
    linkedPermitId: { type: String, required: true, trim: true, index: true },
    linkedPermitName: { type: String, required: true, trim: true },
    fileName: { type: String, required: true, trim: true },
    mimeType: { type: String, required: true, trim: true },
    contentBase64: { type: String, required: true, trim: true },
    watermarkText: {
      type: String,
      required: true,
      trim: true,
      default: "BPLO GENERATED DOCUMENT - REVIEW COPY",
    },
    watermarkFontSizePt: {
      type: Number,
      required: true,
      min: 12,
      max: 200,
      default: 48,
    },
    status: {
      type: String,
      required: true,
      enum: ["active", "inactive"],
      default: "inactive",
    },
    version: { type: Number, required: true, default: 1, min: 1 },
    placeholders: { type: [String], required: true, default: [] },
    mappings: {
      type: [PermitTemplateMappingSchema],
      required: true,
      default: [],
    },
    autoIncrementStates: {
      type: [PermitTemplateAutoIncrementStateSchema],
      required: true,
      default: [],
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "accounts",
      required: true,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "accounts",
      required: false,
    },
    activatedAt: { type: Date, required: false, default: null },
    deactivatedAt: { type: Date, required: false, default: null },
  },
  { timestamps: true },
);

// Register the permit templates collection model.
const PermitTemplate: Model<PermitTemplateDocumentType> = model<
  PermitTemplateDocumentType,
  Model<PermitTemplateDocumentType>
>("permit_templates", PermitTemplateSchema);

export default PermitTemplate;
