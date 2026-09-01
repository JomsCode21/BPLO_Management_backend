import Permit from "@/models/permit/permit.model";
import {
  PermitFieldType,
  PermitFieldTypeOption,
  PermitFieldValidationKind,
  PermitFieldValidationType,
  PermitPlaceholderMode,
  PermitSectionLayout,
  PermitSectionType,
  PermitType,
} from "@/types/models/permit.type";
import { Types } from "mongoose";

const FIELD_TYPES_WITH_OPTIONS: PermitFieldType[] = [
  "select",
  "checkbox",
  "radio",
];
const SECTION_LAYOUTS: PermitSectionLayout[] = ["one_column", "two_column"];
const DEFAULT_SECTION_ID = "section_general_information";
const PLACEHOLDER_MODES: PermitPlaceholderMode[] = ["manual", "automatic"];
const FIELD_TYPES_WITH_VALIDATION: PermitFieldType[] = ["text", "textarea"];
const FIELD_VALIDATION_KINDS: PermitFieldValidationKind[] = [
  "none",
  "letters_only",
  "numbers_only",
  "alphanumeric",
  "custom_regex",
];

// Provide the fallback section used when no custom sections exist.
const createDefaultSection = (): PermitSectionType => ({
  id: DEFAULT_SECTION_ID,
  title: "General Information",
  layout: "one_column",
});

// Clean option lists and discard empty entries.
const sanitizeOptions = (options: unknown): string[] => {
  if (!Array.isArray(options)) return [];
  return options
    .map((option) => String(option ?? "").trim())
    .filter((option) => option.length > 0);
};

// Normalize validation config and preserve custom regex only when needed.
const sanitizeValidation = (
  rawValidation: unknown,
  type: PermitFieldType,
): PermitFieldValidationType => {
  if (!FIELD_TYPES_WITH_VALIDATION.includes(type)) {
    return { kind: "none", regex: "", message: "" };
  }

  const rawKind = String((rawValidation as any)?.kind ?? "none").trim();
  const kind = FIELD_VALIDATION_KINDS.includes(
    rawKind as PermitFieldValidationKind,
  )
    ? (rawKind as PermitFieldValidationKind)
    : "none";
  const regex = String((rawValidation as any)?.regex ?? "").trim();
  const message = String((rawValidation as any)?.message ?? "").trim();

  if (kind !== "custom_regex") {
    return { kind, regex: "", message };
  }

  return { kind, regex, message };
};

// Shape each submitted field into the permit field schema.
const sanitizeField = (rawField: any, index: number): PermitFieldTypeOption => {
  const type = String(rawField?.type ?? "").trim() as PermitFieldType;
  const label = String(rawField?.label ?? "").trim();
  const rawPlaceholderMode = String(
    rawField?.placeholderMode ?? "manual",
  ).trim() as PermitPlaceholderMode;
  const placeholderMode = PLACEHOLDER_MODES.includes(rawPlaceholderMode)
    ? rawPlaceholderMode
    : "manual";

  return {
    id: String(rawField?.id ?? `field_${index + 1}`).trim(),
    type,
    label,
    placeholder:
      placeholderMode === "automatic"
        ? label
        : String(rawField?.placeholder ?? "").trim(),
    placeholderMode,
    validation: sanitizeValidation(rawField?.validation, type),
    required: Boolean(rawField?.required),
    options: FIELD_TYPES_WITH_OPTIONS.includes(type)
      ? sanitizeOptions(rawField?.options)
      : [],
    sectionId: String(rawField?.sectionId ?? "").trim(),
  };
};

// Normalize section payloads and guarantee a usable default section.
const sanitizeSections = (sections: unknown): PermitSectionType[] => {
  if (!Array.isArray(sections) || sections.length === 0) {
    return [createDefaultSection()];
  }

  const sanitized = sections
    .map((section, index) => {
      const layout = String(
        (section as any)?.layout ?? "",
      ).trim() as PermitSectionLayout;
      const normalizedLayout = SECTION_LAYOUTS.includes(layout)
        ? layout
        : "one_column";

      return {
        id: String((section as any)?.id ?? `section_${index + 1}`).trim(),
        title: String((section as any)?.title ?? "").trim(),
        layout: normalizedLayout,
      };
    })
    .filter((section) => section.id && section.title);

  if (sanitized.length === 0) {
    return [createDefaultSection()];
  }

  return sanitized;
};

// Create a new permit with the default form scaffold.
export const createPermitS = async (
  data: { name: string; description?: string },
  createdBy?: string,
) => {
  const payload: Partial<PermitType> = {
    name: data.name.trim(),
    description: data.description?.trim() ?? "",
    showInPermitValidity: true,
    enablePermitValidityFormDisplay: false,
    permitValidityDisplayFieldIds: [],
    formTitle: data.name.trim(),
    formDescription: "",
    sections: [createDefaultSection()],
    fields: [],
  };

  if (createdBy) {
    payload.createdBy = new Types.ObjectId(createdBy);
  }

  const permit = await Permit.create(payload);
  return permit.toObject();
};

// Return the list of active permits for the admin UI.
export const getPermitsS = async () => {
  return Permit.find({ isActive: true }).sort({ createdAt: -1 }).lean();
};

// Load one permit record by identifier.
export const getPermitByIdS = async (permitId: string) => {
  return Permit.findById(permitId).lean();
};

// Save the permit form structure and normalize sections and fields.
export const savePermitFormS = async (
  permitId: string,
  payload: {
    formTitle?: string;
    formDescription?: string;
    sections?: unknown[];
    fields: unknown[];
  },
) => {
  const sections = sanitizeSections(payload.sections);
  const validSectionIds = new Set(sections.map((section) => section.id));
  const fallbackSectionId = sections[0].id;

  const fields = Array.isArray(payload.fields)
    ? payload.fields.map((field, index) => {
        const sanitizedField = sanitizeField(field, index);
        return {
          ...sanitizedField,
          sectionId: validSectionIds.has(sanitizedField.sectionId ?? "")
            ? sanitizedField.sectionId
            : fallbackSectionId,
        };
      })
    : [];

  const updatedPermit = await Permit.findByIdAndUpdate(
    permitId,
    {
      formTitle: String(payload.formTitle ?? "").trim(),
      formDescription: String(payload.formDescription ?? "").trim(),
      sections,
      fields,
    },
    { returnDocument: "after", runValidators: true },
  ).lean();

  return updatedPermit;
};

// Toggle whether this permit appears in the validity view.
export const updatePermitValidityVisibilityS = async (
  permitId: string,
  showInPermitValidity: boolean,
) => {
  const updatedPermit = await Permit.findByIdAndUpdate(
    permitId,
    { showInPermitValidity },
    { returnDocument: "after", runValidators: true },
  ).lean();

  return updatedPermit;
};

// Persist the configured permit-validity display settings.
export const updatePermitValiditySettingsS = async (
  permitId: string,
  payload: {
    showInPermitValidity: boolean;
    enablePermitValidityFormDisplay: boolean;
    permitValidityDisplayFieldIds: string[];
  },
) => {
  const permit = await Permit.findById(permitId).lean();
  if (!permit) return null;

  const allowedFieldIds = new Set(
    (permit.fields ?? [])
      .map((field) => String(field?.id ?? "").trim())
      .filter((fieldId) => fieldId.length > 0),
  );

  const sanitizedFieldIds = Array.from(
    new Set(
      (payload.permitValidityDisplayFieldIds ?? [])
        .map((fieldId) => String(fieldId ?? "").trim())
        .filter(
          (fieldId) => fieldId.length > 0 && allowedFieldIds.has(fieldId),
        ),
    ),
  );

  const updatedPermit = await Permit.findByIdAndUpdate(
    permitId,
    {
      showInPermitValidity: payload.showInPermitValidity,
      enablePermitValidityFormDisplay: payload.enablePermitValidityFormDisplay,
      permitValidityDisplayFieldIds: sanitizedFieldIds,
    },
    { returnDocument: "after", runValidators: true },
  ).lean();

  return updatedPermit;
};

// Soft-delete a permit by marking it inactive.
export const deletePermitS = async (permitId: string) => {
  const deletedPermit = await Permit.findByIdAndUpdate(
    permitId,
    { isActive: false },
    { returnDocument: "after" },
  ).lean();

  return deletedPermit;
};
