import {
  DepartmentFeeTemplateDocumentType,
  DepartmentFeeTemplateItemType,
} from "@/types/models/payment.type";
import { model, Model, Schema } from "mongoose";

// Store one fee line item for a department payment template.
const DepartmentFeeTemplateItemSchema =
  new Schema<DepartmentFeeTemplateItemType>(
    {
      feeName: { type: String, required: true, trim: true },
      amount: { type: Number, required: true, min: 0 },
    },
    { _id: false },
  );

// Store department-specific fee assessment templates used in payments.
const DepartmentFeeTemplateSchema =
  new Schema<DepartmentFeeTemplateDocumentType>(
    {
      departmentId: {
        type: String,
        required: true,
        trim: true,
        unique: true,
        index: true,
      },
      departmentName: { type: String, required: true, trim: true },
      items: {
        type: [DepartmentFeeTemplateItemSchema],
        required: true,
        default: [],
      },
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

// Register the department fee template collection model.
const DepartmentFeeTemplate: Model<DepartmentFeeTemplateDocumentType> = model<
  DepartmentFeeTemplateDocumentType,
  Model<DepartmentFeeTemplateDocumentType>
>("department_fee_templates", DepartmentFeeTemplateSchema);

export default DepartmentFeeTemplate;
