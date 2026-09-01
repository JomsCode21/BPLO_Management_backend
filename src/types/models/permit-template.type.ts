import { Document, Types } from "mongoose";

// Enumerates active/inactive states for a template.
export type PermitTemplateStatusType = "active" | "inactive";
// Enumerates document scopes supported by template generation.
export type PermitTemplateScopeType = "permit" | "inspection_certificate";

// Enumerates supported placeholder mapping sources.
export type PermitTemplateMappingSourceType =
  | "system"
  | "field"
  | "fixed_value"
  | "auto_increment";

// Enumerates reset policies for auto-increment placeholders.
export type PermitTemplateAutoIncrementResetRuleType =
  | "no_reset"
  | "yearly"
  | "monthly";

// Configures how auto-increment placeholders are rendered.
export type PermitTemplateAutoIncrementConfigType = {
  prefix?: string;
  suffix?: string;
  paddingLength: number;
  resetRule: PermitTemplateAutoIncrementResetRuleType;
};

// Represents placeholder mapping definitions for one template.
export type PermitTemplatePlaceholderMappingType = {
  placeholder: string;
  label: string;
  sourceType: PermitTemplateMappingSourceType;
  sourceKey: string;
  fixedValue?: string;
  autoIncrement?: PermitTemplateAutoIncrementConfigType;
  latestAssignedValue?: string;
  confidence: "high" | "medium" | "low";
  needsReview: boolean;
};

// Tracks persisted auto-increment counter state per placeholder.
export type PermitTemplateAutoIncrementStateType = {
  placeholder: string;
  lastPeriodKey: string;
  currentValue: number;
  lastAssignedValue?: string;
  updatedAt: Date;
};

// Represents the full permit template model shape.
export type PermitTemplateType = {
  _id: string;
  templateScope: PermitTemplateScopeType;
  name: string;
  linkedPermitId: string;
  linkedPermitName: string;
  fileName: string;
  mimeType: string;
  contentBase64: string;
  watermarkText: string;
  watermarkFontSizePt: number;
  status: PermitTemplateStatusType;
  version: number;
  placeholders: string[];
  mappings: PermitTemplatePlaceholderMappingType[];
  autoIncrementStates?: PermitTemplateAutoIncrementStateType[];
  createdBy: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  activatedAt?: Date | null;
  deactivatedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
};

// Represents a hydrated mongoose permit template document.
export type PermitTemplateDocumentType = PermitTemplateType & Document;
