import { Document, Types } from "mongoose";

// Enumerates supported dynamic permit field input types.
export type PermitFieldType =
  | "text"
  | "textarea"
  | "select"
  | "checkbox"
  | "radio"
  | "date"
  | "file";

// Enumerates placeholder behavior modes in form builder fields.
export type PermitPlaceholderMode = "manual" | "automatic";

// Enumerates available validation strategies for text-based fields.
export type PermitFieldValidationKind =
  | "none"
  | "letters_only"
  | "numbers_only"
  | "alphanumeric"
  | "custom_regex";

// Represents validation configuration for a permit field.
export type PermitFieldValidationType = {
  kind: PermitFieldValidationKind;
  regex?: string;
  message?: string;
};

// Represents one configurable field in a permit form.
export type PermitFieldTypeOption = {
  id: string;
  type: PermitFieldType;
  label: string;
  placeholder?: string;
  placeholderMode?: PermitPlaceholderMode;
  validation?: PermitFieldValidationType;
  required: boolean;
  options?: string[];
  sectionId?: string;
};

// Enumerates section layout options in the permit form builder.
export type PermitSectionLayout = "one_column" | "two_column";

// Represents one section grouping in a permit form.
export type PermitSectionType = {
  id: string;
  title: string;
  layout: PermitSectionLayout;
};

// Represents the full permit model shape.
export type PermitType = {
  _id: string;
  name: string;
  description?: string;
  showInPermitValidity: boolean;
  enablePermitValidityFormDisplay: boolean;
  permitValidityDisplayFieldIds: string[];
  formTitle?: string;
  formDescription?: string;
  sections: PermitSectionType[];
  fields: PermitFieldTypeOption[];
  createdBy?: Types.ObjectId;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

// Represents a hydrated mongoose permit document.
export type PermitDocumentType = PermitType & Document;
