import { Document, Types } from "mongoose";

// Represents one fee line item in a department payment template.
export type DepartmentFeeTemplateItemType = {
  feeName: string;
  amount: number;
};

// Represents a department-level fee template configuration.
export type DepartmentFeeTemplateType = {
  _id: string;
  departmentId: string;
  departmentName: string;
  items: DepartmentFeeTemplateItemType[];
  totalAmount: number;
  createdBy?: Types.ObjectId | null;
  createdByName?: string;
  updatedBy?: Types.ObjectId | null;
  updatedByName?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

// Represents a hydrated mongoose department fee template document.
export type DepartmentFeeTemplateDocumentType = DepartmentFeeTemplateType &
  Document;

// Represents one fee line item in a BPLO admin fee template.
export type AdminFeeTemplateItemType = {
  feeName: string;
  amount: number;
};

// Represents a permit-specific BPLO admin fee template.
export type AdminFeeTemplateType = {
  _id: string;
  permitId: string;
  permitName: string;
  items: AdminFeeTemplateItemType[];
  totalAmount: number;
  createdBy?: Types.ObjectId | null;
  createdByName?: string;
  updatedBy?: Types.ObjectId | null;
  updatedByName?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

// Represents a hydrated mongoose admin fee template document.
export type AdminFeeTemplateDocumentType = AdminFeeTemplateType & Document;
