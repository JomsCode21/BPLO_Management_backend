import {
  PermitDocumentType,
  PermitFieldTypeOption,
  PermitFieldValidationType,
  PermitSectionType,
} from "@/types/models/permit.type";
import { model, Model, Schema } from "mongoose";

// Store permit form section metadata and layout information.
const PermitSectionSchema = new Schema<PermitSectionType>(
  {
    id: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    layout: {
      type: String,
      required: true,
      enum: ["one_column", "two_column"],
      default: "one_column",
    },
  },
  { _id: false },
);

// Store validation rules for individual permit form fields.
const PermitFieldValidationSchema = new Schema<PermitFieldValidationType>(
  {
    kind: {
      type: String,
      required: true,
      enum: [
        "none",
        "letters_only",
        "numbers_only",
        "alphanumeric",
        "custom_regex",
      ],
      default: "none",
    },
    regex: { type: String, required: false, default: "" },
    message: { type: String, required: false, default: "" },
  },
  { _id: false },
);

// Store one permit form field definition and its display options.
const PermitFieldSchema = new Schema<PermitFieldTypeOption>(
  {
    id: { type: String, required: true, trim: true },
    type: {
      type: String,
      required: true,
      enum: ["text", "textarea", "select", "checkbox", "radio", "date", "file"],
    },
    label: { type: String, required: true, trim: true },
    placeholder: { type: String, required: false, default: "" },
    placeholderMode: {
      type: String,
      required: false,
      enum: ["manual", "automatic"],
      default: "manual",
    },
    validation: {
      type: PermitFieldValidationSchema,
      required: false,
      default: { kind: "none", regex: "", message: "" },
    },
    required: { type: Boolean, required: true, default: false },
    options: { type: [String], required: false, default: [] },
    sectionId: { type: String, required: false, default: "" },
  },
  { _id: false },
);

// Store the full permit definition, form structure, and validity settings.
const PermitSchema = new Schema<PermitDocumentType>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, required: false, default: "" },
    showInPermitValidity: { type: Boolean, required: true, default: true },
    enablePermitValidityFormDisplay: {
      type: Boolean,
      required: true,
      default: false,
    },
    permitValidityDisplayFieldIds: {
      type: [String],
      required: true,
      default: [],
    },
    formTitle: { type: String, required: false, default: "" },
    formDescription: { type: String, required: false, default: "" },
    sections: { type: [PermitSectionSchema], required: true, default: [] },
    fields: { type: [PermitFieldSchema], required: true, default: [] },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "accounts",
      required: false,
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Register the permits collection model.
const Permit: Model<PermitDocumentType> = model<
  PermitDocumentType,
  Model<PermitDocumentType>
>("permits", PermitSchema);

export default Permit;
