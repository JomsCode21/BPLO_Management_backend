import {
  InspectionDepartmentType,
  InspectionProcessDocumentType,
} from "@/types/models/process.type";
import { model, Model, Schema } from "mongoose";

// Store one inspection department entry and its ordering.
const InspectionDepartmentSchema = new Schema<InspectionDepartmentType>(
  {
    id: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    sequence: { type: Number, required: true },
  },
  { _id: false },
);

// Store the inspection process configuration shared across routing flows.
const InspectionProcessSchema = new Schema<InspectionProcessDocumentType>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      enum: ["inspection_process"],
      default: "inspection_process",
    },
    name: {
      type: String,
      required: true,
      trim: true,
      default: "Inspection Process",
    },
    departments: {
      type: [InspectionDepartmentSchema],
      required: true,
      default: [],
    },
  },
  { timestamps: true },
);

// Register the inspection process collection model.
const InspectionProcess: Model<InspectionProcessDocumentType> = model<
  InspectionProcessDocumentType,
  Model<InspectionProcessDocumentType>
>("inspection_processes", InspectionProcessSchema);

export default InspectionProcess;
