import {
  AdminFeeTemplateDocumentType,
  AdminFeeTemplateItemType,
} from "@/types/models/payment.type";
import { model, Model, Schema } from "mongoose";

// Store one fee line item for an admin payment template.
const AdminFeeTemplateItemSchema = new Schema<AdminFeeTemplateItemType>(
  {
    feeName: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

// Store permit-based fee assessment templates for admin payment workflows.
const AdminFeeTemplateSchema = new Schema<AdminFeeTemplateDocumentType>(
  {
    permitId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    permitName: { type: String, required: true, trim: true },
    items: { type: [AdminFeeTemplateItemSchema], required: true, default: [] },
    totalAmount: { type: Number, required: true, default: 0, min: 0 },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "accounts",
      required: false,
      default: null,
    },
    createdByName: { type: String, required: false, trim: true, default: "" },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "accounts",
      required: false,
      default: null,
    },
    updatedByName: { type: String, required: false, trim: true, default: "" },
  },
  { timestamps: true },
);

// Register the admin fee template collection model.
const AdminFeeTemplate: Model<AdminFeeTemplateDocumentType> = model<
  AdminFeeTemplateDocumentType,
  Model<AdminFeeTemplateDocumentType>
>("admin_fee_templates", AdminFeeTemplateSchema);

export default AdminFeeTemplate;
