import OwnerApplicationStatus from "@/models/owner_application_status/owner-application-status.model";
import Permit from "@/models/permit/permit.model";
import PermitApplication from "@/models/permit_application/permit-application.model";
import PermitTemplate from "@/models/permit_template/permit-template.model";
import {
  PermitTemplateMappingSourceType,
  PermitTemplatePlaceholderMappingType,
  PermitTemplateScopeType,
} from "@/types/models/permit-template.type";
import { runInTransaction } from "@/utils/db/transaction.util";
import {
  buildWatermarkedPdfFromClearPdf,
  convertDocxBufferToPdfBuffer,
  PDF_MIME_TYPE,
} from "@/utils/document/pdf-generation.util";
import JSZip from "jszip";
import { Types } from "mongoose";

const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PLACEHOLDER_REGEX = /\{[A-Za-z][A-Za-z0-9_]*\}/g;
const STRICT_PLACEHOLDER_REGEX = /^\{[A-Za-z][A-Za-z0-9_]*\}$/;
const SYSTEM_SIGNATORY_DEFAULT = "BPLO Administrator";
const DEFAULT_WATERMARK_TEXT = "BPLO GENERATED DOCUMENT - REVIEW COPY";
const DEFAULT_WATERMARK_FONT_SIZE_PT = 48;
type DocumentGenerationMode = "permit" | "inspection_certificate";
type GeneratedTargetKey = "generatedPermit" | "generatedInspectionCertificate";

const DEFAULT_TEMPLATE_SCOPE: PermitTemplateScopeType = "permit";
const DEFAULT_AUTO_INCREMENT_SUFFIX = "{YYYY}";
const YEARLY_RESET_RULE = "yearly";
const SYSTEM_FIELD_KEYS = new Set([
  "application_id",
  "permit_type",
  "issue_date",
  "valid_until",
  "signatory_name",
]);

// Normalize text before using it in template matching or output.
const normalizeText = (value: unknown) => String(value ?? "").trim();
// Fall back to the default watermark text when the input is empty.
const sanitizeWatermarkText = (value: unknown) => {
  const text = normalizeText(value);
  return text || DEFAULT_WATERMARK_TEXT;
};
// Keep watermark font sizes within a safe printable range.
const sanitizeWatermarkFontSizePt = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_WATERMARK_FONT_SIZE_PT;
  return Math.max(12, Math.min(200, Math.round(parsed)));
};
// Strip separators so placeholder labels can be compared consistently.
const normalizeKey = (value: unknown) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
// Extract a usable ObjectId string from raw values or populated docs.
const toObjectIdString = (value: unknown) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const nestedId = (value as any)?._id;
    if (nestedId) return String(nestedId);
  }
  return String(value);
};
// Canonicalize IDs so template and permit references can be compared safely.
const toCanonicalObjectId = (value: unknown) => {
  const raw = normalizeText(toObjectIdString(value));
  if (!Types.ObjectId.isValid(raw)) return "";
  return new Types.ObjectId(raw).toHexString();
};

// Accept DOCX uploads by extension or MIME type.
const isDocxFile = (fileName: string, mimeType: string) =>
  fileName.toLowerCase().endsWith(".docx") || mimeType === DOCX_MIME_TYPE;

// Decode XML entities before extracting visible text or placeholders.
const decodeXmlEntities = (text: string) =>
  text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

// Convert DOCX page units from twips into millimeters.
const twipsToMm = (twips: number) => (twips * 25.4) / 1440;

const extractDocxPageSizeMm = (xml: string) => {
  const pageSizeMatch = xml.match(/<w:pgSz\b([^>]*)\/?>/);
  if (!pageSizeMatch) return null;

  const attrs = pageSizeMatch[1] ?? "";
  const widthMatch = attrs.match(/\bw:w="(\d+)"/);
  const heightMatch = attrs.match(/\bw:h="(\d+)"/);
  if (!widthMatch || !heightMatch) return null;

  const widthTwips = Number(widthMatch[1]);
  const heightTwips = Number(heightMatch[1]);
  if (!Number.isFinite(widthTwips) || !Number.isFinite(heightTwips))
    return null;

  let width = twipsToMm(widthTwips);
  let height = twipsToMm(heightTwips);
  const orientMatch = attrs.match(/\bw:orient="([^"]+)"/);
  const isLandscape =
    normalizeText(orientMatch?.[1]).toLowerCase() === "landscape";

  if (isLandscape && height > width) {
    [width, height] = [height, width];
  }
  if (!isLandscape && width > height) {
    [width, height] = [height, width];
  }

  return {
    width: Number(width.toFixed(2)),
    height: Number(height.toFixed(2)),
  };
};

const escapeXmlText = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const extractVisibleTextFromXml = (xml: string) => {
  const visibleNodeRegex = /<(w:t|w:instrText)[^>]*>([\s\S]*?)<\/\1>/g;
  const tokens = [...xml.matchAll(visibleNodeRegex)].map((match) =>
    decodeXmlEntities(match[2] ?? ""),
  );

  // Do not inject separators between runs; Word commonly splits a single
  // visible token (like "{ownername}") across multiple runs.
  const stitched = tokens.join("");

  // Normalize control whitespace while preserving the actual placeholder text.
  return stitched.replace(/[\r\n\t]+/g, " ");
};

const getDocxTextEntries = async (contentBase64: string) => {
  const docxBuffer = Buffer.from(contentBase64, "base64");
  const zip = await JSZip.loadAsync(docxBuffer);
  const fileNames = Object.keys(zip.files).filter(
    (name) =>
      name === "word/document.xml" ||
      name.startsWith("word/header") ||
      name.startsWith("word/footer"),
  );

  const entries = await Promise.all(
    fileNames.map(async (name) => ({
      name,
      xml: await zip.file(name)!.async("text"),
    })),
  );

  return { zip, entries };
};

const extractPlaceholdersFromDocx = async (contentBase64: string) => {
  const { entries } = await getDocxTextEntries(contentBase64);
  const allText = entries
    .map((entry) => extractVisibleTextFromXml(entry.xml))
    .join(" ");
  const matches = allText.match(PLACEHOLDER_REGEX) ?? [];

  const valid = [...new Set(matches)]
    .map((placeholder) => placeholder.trim())
    .filter(Boolean)
    .filter((placeholder) => STRICT_PLACEHOLDER_REGEX.test(placeholder))
    .sort((a, b) => a.localeCompare(b));

  return valid;
};

type MappingOptionType = {
  label: string;
  sourceType: PermitTemplateMappingSourceType;
  sourceKey: string;
  aliases: string[];
};

const getSystemMappingOptions = (): MappingOptionType[] => [
  {
    label: "Application ID",
    sourceType: "system",
    sourceKey: "application_id",
    aliases: ["applicationid", "appid", "reference", "referenceid"],
  },
  {
    label: "Permit Type",
    sourceType: "system",
    sourceKey: "permit_type",
    aliases: ["permittype", "permitname", "type"],
  },
  {
    label: "Issue Date",
    sourceType: "system",
    sourceKey: "issue_date",
    aliases: ["issuedate", "dateissued"],
  },
  {
    label: "Valid Until",
    sourceType: "system",
    sourceKey: "valid_until",
    aliases: ["validuntil", "expirydate", "expirationdate"],
  },
  {
    label: "Signatory Name",
    sourceType: "system",
    sourceKey: "signatory_name",
    aliases: ["signatory", "signedby", "authorizedsignatory"],
  },
];

const getFieldMappingOptions = async (
  permitId: string,
): Promise<MappingOptionType[]> => {
  const permit = await Permit.findById(permitId).select("fields").lean();
  if (!permit) return [];

  const unique = new Map<string, MappingOptionType>();

  const fields = Array.isArray(permit.fields) ? permit.fields : [];
  for (const field of fields) {
    const fieldId = normalizeText((field as any).id);
    const label = normalizeText((field as any).label);
    if (!fieldId || !label) continue;
    const sourceKey = `field.${fieldId}`;
    if (unique.has(sourceKey)) continue;
    const normalizedLabel = normalizeKey(label);
    unique.set(sourceKey, {
      label,
      sourceType: "field",
      sourceKey,
      aliases: [normalizedLabel],
    });
  }

  const approvedApplications = await PermitApplication.find({
    permit: new Types.ObjectId(permitId),
    status: "approved",
  })
    .select("responses")
    .lean();

  for (const application of approvedApplications) {
    const responses = Array.isArray((application as any)?.responses)
      ? (application as any).responses
      : [];
    for (const response of responses) {
      const fieldId = normalizeText(response?.fieldId);
      const label = normalizeText(response?.label);
      if (!fieldId || !label) continue;
      const sourceKey = `field.${fieldId}`;
      if (unique.has(sourceKey)) continue;
      unique.set(sourceKey, {
        label,
        sourceType: "field",
        sourceKey,
        aliases: [normalizeKey(label)],
      });
    }
  }

  return [...unique.values()].sort((a, b) => a.label.localeCompare(b.label));
};

const getMappingOptions = async (
  permitId: string,
): Promise<MappingOptionType[]> => {
  const [systemOptions, fieldOptions] = await Promise.all([
    Promise.resolve(getSystemMappingOptions()),
    getFieldMappingOptions(permitId),
  ]);

  // Keep field-first ordering so auto-suggestion prefers actual submitted form values.
  return [...fieldOptions, ...systemOptions];
};

const suggestMapping = (
  placeholder: string,
  options: MappingOptionType[],
): PermitTemplatePlaceholderMappingType => {
  const rawKey = placeholder.replace(/[{}]/g, "");
  const normalizedPlaceholder = normalizeKey(rawKey);

  const exactCandidates = options.filter(
    (option) =>
      normalizeKey(option.label) === normalizedPlaceholder ||
      option.aliases.some((alias) => alias === normalizedPlaceholder) ||
      normalizeKey(option.sourceKey) === normalizedPlaceholder,
  );
  const exact = exactCandidates.sort((a, b) => {
    if (a.sourceType === b.sourceType) return 0;
    return a.sourceType === "field" ? -1 : 1;
  })[0];

  if (exact) {
    return {
      placeholder,
      label: exact.label,
      sourceType: exact.sourceType,
      sourceKey: exact.sourceKey,
      confidence: "high",
      needsReview: false,
    };
  }

  const partialCandidates = options.filter((option) => {
    const normalizedLabel = normalizeKey(option.label);
    return (
      normalizedPlaceholder.includes(normalizedLabel) ||
      normalizedLabel.includes(normalizedPlaceholder) ||
      option.aliases.some((alias) => normalizedPlaceholder.includes(alias))
    );
  });
  const partial = partialCandidates.sort((a, b) => {
    if (a.sourceType === b.sourceType) return 0;
    return a.sourceType === "field" ? -1 : 1;
  })[0];

  if (partial) {
    return {
      placeholder,
      label: partial.label,
      sourceType: partial.sourceType,
      sourceKey: partial.sourceKey,
      confidence: "medium",
      needsReview: true,
    };
  }

  return {
    placeholder,
    label: "",
    sourceType: "field",
    sourceKey: "",
    fixedValue: "",
    autoIncrement: null as any,
    confidence: "low",
    needsReview: true,
  };
};

const toTemplateResponse = (template: any) => {
  const autoIncrementStateMap = new Map<string, string>();
  const states = Array.isArray(template.autoIncrementStates)
    ? template.autoIncrementStates
    : [];
  states.forEach((state: any) => {
    const key = normalizeText(state?.placeholder);
    const value = normalizeText(state?.lastAssignedValue);
    if (key && value) {
      autoIncrementStateMap.set(key, value);
    }
  });

  const mappings = Array.isArray(template.mappings)
    ? template.mappings.map((mapping: any) => ({
        ...mapping,
        latestAssignedValue:
          normalizeText(mapping?.sourceType) === "auto_increment"
            ? (autoIncrementStateMap.get(normalizeText(mapping?.placeholder)) ??
              "")
            : "",
      }))
    : [];

  return {
    _id: String(template._id),
    templateScope:
      normalizeText(template.templateScope) === "inspection_certificate"
        ? "inspection_certificate"
        : "permit",
    name: normalizeText(template.name),
    linkedPermitId: normalizeText(template.linkedPermitId),
    linkedPermitName: normalizeText(template.linkedPermitName),
    fileName: normalizeText(template.fileName),
    mimeType: normalizeText(template.mimeType),
    watermarkText: sanitizeWatermarkText(template.watermarkText),
    watermarkFontSizePt: sanitizeWatermarkFontSizePt(
      template.watermarkFontSizePt,
    ),
    status: normalizeText(template.status) === "active" ? "active" : "inactive",
    version: Number(template.version ?? 1),
    placeholders: Array.isArray(template.placeholders)
      ? template.placeholders
      : [],
    mappings,
    activatedAt: template.activatedAt ?? null,
    deactivatedAt: template.deactivatedAt ?? null,
    createdAt: template.createdAt ?? null,
    updatedAt: template.updatedAt ?? null,
  };
};

const ensureTemplateMappings = (
  placeholders: string[],
  mappings: PermitTemplatePlaceholderMappingType[],
) => {
  const mappingMap = new Map(
    mappings.map((mapping) => [normalizeText(mapping.placeholder), mapping]),
  );

  const unresolved = placeholders.find((placeholder) => {
    const mapping = mappingMap.get(placeholder);
    if (!mapping) return true;
    const sourceKey = normalizeText(mapping.sourceKey);
    const fixedValue = normalizeText((mapping as any).fixedValue);
    const autoIncrement = (mapping as any).autoIncrement;

    if (mapping.sourceType === "field") {
      return !sourceKey.startsWith("field.");
    }
    if (mapping.sourceType === "system") {
      return !SYSTEM_FIELD_KEYS.has(sourceKey);
    }
    if (mapping.sourceType === "fixed_value") {
      return !fixedValue;
    }
    if (mapping.sourceType === "auto_increment") {
      const paddingLength = Number(autoIncrement?.paddingLength ?? 0);
      const resetRule = normalizeText(autoIncrement?.resetRule);
      return (
        !(
          sourceKey === "auto_increment" ||
          sourceKey.startsWith("auto_increment")
        ) ||
        !Number.isInteger(paddingLength) ||
        paddingLength < 1 ||
        paddingLength > 12 ||
        resetRule !== YEARLY_RESET_RULE
      );
    }
    return true;
  });

  if (unresolved) {
    throw new Error(`Unmapped placeholder detected: ${unresolved}`);
  }
};

const formatDate = (value: Date | string | null | undefined) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
};

const getSystemValue = (params: { sourceKey: string; application: any }) => {
  const issueDate = formatDate(params.application?.adminResult?.decidedAt);
  const submittedAt = formatDate(params.application?.submittedAt);
  const now = new Date();
  const validUntil = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);

  const responseMap = new Map<
    string,
    { value?: string | string[] | null; label: string; type?: string }
  >(
    (params.application?.responses ?? []).map((response: any) => [
      normalizeText(response?.fieldId),
      {
        value: response?.value,
        label: normalizeText(response?.label),
        type: normalizeText(response?.type),
      },
    ]),
  );
  const responseByLabel = [...responseMap.values()];

  const responseValueToString = (params: {
    value: string | string[] | null | undefined;
    type?: string;
  }) => {
    const normalizedType = normalizeText(params.type);
    if (normalizedType === "date") {
      const rawDate = Array.isArray(params.value)
        ? normalizeText(params.value[0])
        : normalizeText(params.value);
      return formatDate(rawDate) || rawDate;
    }

    if (Array.isArray(params.value)) return params.value.join(", ");
    return normalizeText(params.value);
  };

  const findResponseValueByLabel = (...needles: string[]) => {
    const normalizedNeedles = needles.map((needle) => normalizeKey(needle));

    const exact = responseByLabel.find((entry) => {
      const label = normalizeKey(entry.label);
      return normalizedNeedles.some((needle) => label === needle);
    });
    if (exact) {
      return responseValueToString({ value: exact.value, type: exact.type });
    }

    const includes = responseByLabel.find((entry) => {
      const label = normalizeKey(entry.label);
      return normalizedNeedles.some((needle) => label.includes(needle));
    });
    if (includes) {
      return responseValueToString({
        value: includes.value,
        type: includes.type,
      });
    }

    return "";
  };

  if (params.sourceKey === "application_id") {
    return String(params.application?._id ?? "");
  }
  if (params.sourceKey === "permit_type") {
    return (
      normalizeText((params.application?.permit as any)?.name) ||
      normalizeText(params.application?.permitName)
    );
  }
  if (params.sourceKey === "business_owner_name") {
    return findResponseValueByLabel(
      "business owner name",
      "owner name",
      "proprietor",
      "applicant name",
      "applicant",
      "owner",
    );
  }
  if (params.sourceKey === "issue_date") {
    return issueDate || submittedAt;
  }
  if (params.sourceKey === "start_date") {
    return findResponseValueByLabel(
      "start date",
      "date start",
      "operation date",
      "date of start",
      "operation start date",
    );
  }
  if (params.sourceKey === "valid_until") {
    return formatDate(validUntil);
  }
  if (params.sourceKey === "signatory_name") {
    return SYSTEM_SIGNATORY_DEFAULT;
  }
  if (params.sourceKey === "business_name") {
    return findResponseValueByLabel(
      "business name",
      "trade name",
      "establishment name",
    );
  }
  if (params.sourceKey === "business_address") {
    return findResponseValueByLabel(
      "business address",
      "business location",
      "address",
    );
  }

  return "";
};

const resolveFieldValue = (params: { application: any; sourceKey: string }) => {
  const fieldId = params.sourceKey.replace(/^field\./, "").trim();
  const responses = Array.isArray(params.application?.responses)
    ? params.application.responses
    : [];

  const direct = responses.find(
    (response: any) => normalizeText(response?.fieldId) === fieldId,
  );
  if (!direct) return "";
  if (normalizeText(direct.type) === "date") {
    const rawDate = Array.isArray(direct.value)
      ? normalizeText(direct.value[0])
      : normalizeText(direct.value);
    return formatDate(rawDate) || rawDate;
  }
  if (Array.isArray(direct.value)) return direct.value.join(", ");
  return normalizeText(direct.value);
};

const resolveDateTokens = (value: string, now: Date) =>
  value
    .replace(/\{YYYY\}/g, String(now.getFullYear()))
    .replace(/\{YY\}/g, String(now.getFullYear()).slice(-2))
    .replace(/\{MM\}/g, String(now.getMonth() + 1).padStart(2, "0"));

const normalizeAutoIncrementSuffix = (suffix: unknown) => {
  const normalized = normalizeText(suffix);
  return normalized || DEFAULT_AUTO_INCREMENT_SUFFIX;
};

const getCounterPeriodKey = (resetRule: string, now: Date) => {
  if (resetRule === "monthly") {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }
  if (resetRule === "yearly") {
    return String(now.getFullYear());
  }
  return "all";
};

const replaceFragmentedPlaceholdersInXml = (
  xml: string,
  resolvedValues: Record<string, string>,
) => {
  const fragmentedPlaceholderRegex = /\{(?:[^{}]|<[^>]+>)*\}/g;

  return xml.replace(fragmentedPlaceholderRegex, (chunk) => {
    const visibleToken = decodeXmlEntities(chunk.replace(/<[^>]+>/g, ""));
    if (!STRICT_PLACEHOLDER_REGEX.test(visibleToken)) return chunk;

    if (!Object.prototype.hasOwnProperty.call(resolvedValues, visibleToken)) {
      return chunk;
    }

    return escapeXmlText(normalizeText(resolvedValues[visibleToken]));
  });
};

const renderDocx = async (params: {
  contentBase64: string;
  resolvedValues: Record<string, string>;
}) => {
  const { zip, entries } = await getDocxTextEntries(params.contentBase64);

  for (const entry of entries) {
    let updatedXml = entry.xml;

    updatedXml = replaceFragmentedPlaceholdersInXml(
      updatedXml,
      params.resolvedValues,
    );

    for (const [placeholder, value] of Object.entries(params.resolvedValues)) {
      const safeValue = escapeXmlText(normalizeText(value));
      updatedXml = updatedXml.split(placeholder).join(safeValue);
    }

    zip.file(entry.name, updatedXml);
  }

  const rendered = await zip.generateAsync({ type: "base64" });
  return rendered;
};

// Return the available placeholder mappings for a permit template.
export const getPermitTemplateMappingOptionsS = async (permitId: string) => {
  if (!Types.ObjectId.isValid(permitId)) {
    throw new Error("Invalid permit ID.");
  }
  const options = await getMappingOptions(permitId);
  return options.map((option) => ({
    label: option.label,
    sourceType: option.sourceType,
    sourceKey: option.sourceKey,
  }));
};

// Upload a new DOCX template and infer its placeholder mappings.
export const uploadPermitTemplateS = async (params: {
  permitId: string;
  fileName: string;
  mimeType: string;
  contentBase64: string;
  watermarkText?: string;
  watermarkFontSizePt?: number;
  adminId: string;
  templateScope?: PermitTemplateScopeType;
}) => {
  const templateScope = params.templateScope ?? DEFAULT_TEMPLATE_SCOPE;
  if (!Types.ObjectId.isValid(params.permitId)) {
    throw new Error("Invalid permit ID.");
  }
  if (!isDocxFile(params.fileName, params.mimeType)) {
    throw new Error("Only .docx template files are allowed.");
  }
  const linkedPermit = await Permit.findById(params.permitId)
    .select("name")
    .lean();
  if (!linkedPermit) {
    throw new Error("Linked permit not found.");
  }

  const placeholders = await extractPlaceholdersFromDocx(params.contentBase64);
  if (placeholders.length === 0) {
    throw new Error("No valid placeholders detected in the uploaded DOCX.");
  }

  const options = await getMappingOptions(params.permitId);
  const mappings = placeholders.map((placeholder) =>
    suggestMapping(placeholder, options),
  );

  const template = await PermitTemplate.create({
    templateScope,
    name: normalizeText(linkedPermit.name),
    linkedPermitId: String(linkedPermit._id),
    linkedPermitName: normalizeText(linkedPermit.name),
    fileName: normalizeText(params.fileName),
    mimeType: DOCX_MIME_TYPE,
    contentBase64: normalizeText(params.contentBase64),
    watermarkText: sanitizeWatermarkText(params.watermarkText),
    watermarkFontSizePt: sanitizeWatermarkFontSizePt(
      params.watermarkFontSizePt,
    ),
    status: "inactive",
    version: 1,
    placeholders,
    mappings,
    createdBy: new Types.ObjectId(params.adminId),
    updatedBy: new Types.ObjectId(params.adminId),
  });

  return toTemplateResponse(template.toObject());
};

// List every template within the requested scope.
export const listPermitTemplatesS = async (
  templateScope: PermitTemplateScopeType = DEFAULT_TEMPLATE_SCOPE,
) => {
  const templates = await PermitTemplate.find({
    ...buildTemplateScopeFilter(templateScope),
  })
    .sort({ createdAt: -1, updatedAt: -1 })
    .lean();

  return templates.map(toTemplateResponse);
};

// Load one template record within the requested scope.
export const getPermitTemplateByIdS = async (
  templateId: string,
  templateScope: PermitTemplateScopeType = DEFAULT_TEMPLATE_SCOPE,
) => {
  if (!Types.ObjectId.isValid(templateId)) return null;
  const template = await PermitTemplate.findOne({
    _id: templateId,
    ...buildTemplateScopeFilter(templateScope),
  }).lean();
  if (!template) return null;
  return toTemplateResponse(template);
};

// Remove a template within the requested scope.
export const deletePermitTemplateS = async (
  templateId: string,
  templateScope: PermitTemplateScopeType = DEFAULT_TEMPLATE_SCOPE,
) => {
  if (!Types.ObjectId.isValid(templateId)) return null;
  const deleted = await PermitTemplate.findOneAndDelete({
    _id: templateId,
    ...buildTemplateScopeFilter(templateScope),
  }).lean();
  if (!deleted) return null;
  return toTemplateResponse(deleted);
};

// Replace the DOCX file while keeping the existing template metadata.
export const replacePermitTemplateFileS = async (params: {
  templateId: string;
  fileName: string;
  mimeType: string;
  contentBase64: string;
  watermarkText?: string;
  watermarkFontSizePt?: number;
  adminId: string;
  templateScope?: PermitTemplateScopeType;
}) => {
  const templateScope = params.templateScope ?? DEFAULT_TEMPLATE_SCOPE;
  if (!Types.ObjectId.isValid(params.templateId)) return null;
  if (!isDocxFile(params.fileName, params.mimeType)) {
    throw new Error("Only .docx template files are allowed.");
  }

  const existing = await PermitTemplate.findOne({
    _id: params.templateId,
    ...buildTemplateScopeFilter(templateScope),
  });
  if (!existing) return null;

  const placeholders = await extractPlaceholdersFromDocx(params.contentBase64);
  if (placeholders.length === 0) {
    throw new Error("No valid placeholders detected in the uploaded DOCX.");
  }

  const existingMappingMap = new Map(
    (existing.mappings ?? []).map((mapping) => [mapping.placeholder, mapping]),
  );
  const options = await getMappingOptions(
    String(existing.linkedPermitId ?? ""),
  );
  const nextMappings = placeholders.map((placeholder) => {
    const existingMapping = existingMappingMap.get(placeholder);
    if (existingMapping) return existingMapping;
    return suggestMapping(placeholder, options);
  });

  existing.fileName = normalizeText(params.fileName);
  existing.mimeType = DOCX_MIME_TYPE;
  existing.contentBase64 = normalizeText(params.contentBase64);
  existing.watermarkText = params.watermarkText
    ? sanitizeWatermarkText(params.watermarkText)
    : sanitizeWatermarkText(existing.watermarkText);
  existing.watermarkFontSizePt =
    params.watermarkFontSizePt !== undefined
      ? sanitizeWatermarkFontSizePt(params.watermarkFontSizePt)
      : sanitizeWatermarkFontSizePt(existing.watermarkFontSizePt);
  existing.placeholders = placeholders;
  existing.mappings = nextMappings as any;
  existing.version = Number(existing.version ?? 1) + 1;
  existing.updatedBy = new Types.ObjectId(params.adminId);

  const saved = await existing.save();
  return toTemplateResponse(saved.toObject());
};

// Update the watermark settings for a template.
export const updatePermitTemplateWatermarkS = async (params: {
  templateId: string;
  watermarkText: string;
  watermarkFontSizePt: number;
  adminId: string;
  templateScope?: PermitTemplateScopeType;
}) => {
  const templateScope = params.templateScope ?? DEFAULT_TEMPLATE_SCOPE;
  if (!Types.ObjectId.isValid(params.templateId)) return null;
  const template = await PermitTemplate.findOne({
    _id: params.templateId,
    ...buildTemplateScopeFilter(templateScope),
  });
  if (!template) return null;

  template.watermarkText = sanitizeWatermarkText(params.watermarkText);
  template.watermarkFontSizePt = sanitizeWatermarkFontSizePt(
    params.watermarkFontSizePt,
  );
  template.updatedBy = new Types.ObjectId(params.adminId);
  const saved = await template.save();
  return toTemplateResponse(saved.toObject());
};

// Activate or deactivate a template and update competing records.
export const setPermitTemplateStatusS = async (params: {
  templateId: string;
  status: "active" | "inactive";
  adminId: string;
  templateScope?: PermitTemplateScopeType;
}) => {
  const templateScope = params.templateScope ?? DEFAULT_TEMPLATE_SCOPE;
  if (!Types.ObjectId.isValid(params.templateId)) return null;

  const template = await PermitTemplate.findOne({
    _id: params.templateId,
    ...buildTemplateScopeFilter(templateScope),
  });
  if (!template) return null;

  if (params.status === "active") {
    await PermitTemplate.updateMany(
      {
        _id: { $ne: String(template._id) },
        status: "active",
        linkedPermitId: String(template.linkedPermitId ?? ""),
        ...buildTemplateScopeFilter(templateScope),
      },
      {
        status: "inactive",
        deactivatedAt: new Date(),
        updatedBy: new Types.ObjectId(params.adminId),
      },
    );
    template.status = "active";
    template.activatedAt = new Date();
    template.deactivatedAt = null;
  } else {
    template.status = "inactive";
    template.deactivatedAt = new Date();
  }

  template.updatedBy = new Types.ObjectId(params.adminId);
  const saved = await template.save();
  return toTemplateResponse(saved.toObject());
};

// Persist the placeholder-to-source mapping configuration.
export const savePermitTemplateMappingsS = async (params: {
  templateId: string;
  mappings: PermitTemplatePlaceholderMappingType[];
  adminId: string;
  watermarkText?: string;
  watermarkFontSizePt?: number;
  templateScope?: PermitTemplateScopeType;
}) => {
  const templateScope = params.templateScope ?? DEFAULT_TEMPLATE_SCOPE;
  if (!Types.ObjectId.isValid(params.templateId)) return null;
  const template = await PermitTemplate.findOne({
    _id: params.templateId,
    ...buildTemplateScopeFilter(templateScope),
  });
  if (!template) return null;

  const placeholderSet = new Set(template.placeholders ?? []);
  const cleaned = params.mappings.map((mapping) => ({
    placeholder: normalizeText(mapping.placeholder),
    label: normalizeText(mapping.label),
    sourceType: mapping.sourceType,
    sourceKey: normalizeText(mapping.sourceKey),
    fixedValue: normalizeText((mapping as any).fixedValue),
    autoIncrement:
      mapping.sourceType === "auto_increment"
        ? {
            prefix: normalizeText((mapping as any)?.autoIncrement?.prefix),
            suffix: normalizeAutoIncrementSuffix(
              (mapping as any)?.autoIncrement?.suffix,
            ),
            paddingLength: Number(
              (mapping as any)?.autoIncrement?.paddingLength ?? 4,
            ),
            resetRule: YEARLY_RESET_RULE,
          }
        : null,
    confidence: mapping.confidence,
    needsReview: Boolean(mapping.needsReview),
  }));

  const hasInvalidPlaceholder = cleaned.some(
    (mapping) => !placeholderSet.has(mapping.placeholder),
  );
  if (hasInvalidPlaceholder) {
    throw new Error("Invalid template placeholder mapping detected.");
  }

  const hasInvalidSource = cleaned.some((mapping) => {
    if (mapping.sourceType === "system") {
      return !SYSTEM_FIELD_KEYS.has(mapping.sourceKey);
    }
    if (mapping.sourceType === "field") {
      return !mapping.sourceKey.startsWith("field.");
    }
    if (mapping.sourceType === "fixed_value") {
      return !mapping.fixedValue;
    }
    if (mapping.sourceType === "auto_increment") {
      const paddingLength = Number(mapping.autoIncrement?.paddingLength ?? 0);
      const resetRule = normalizeText(mapping.autoIncrement?.resetRule);
      return (
        !(
          mapping.sourceKey === "auto_increment" ||
          mapping.sourceKey.startsWith("auto_increment")
        ) ||
        !Number.isInteger(paddingLength) ||
        paddingLength < 1 ||
        paddingLength > 12 ||
        resetRule !== YEARLY_RESET_RULE
      );
    }
    return true;
  });

  if (hasInvalidSource) {
    throw new Error("Invalid mapping source configuration detected.");
  }

  const mappedPlaceholderSet = new Set(
    cleaned.map((mapping) => mapping.placeholder),
  );
  const missingPlaceholder = (template.placeholders ?? []).find(
    (placeholder) => !mappedPlaceholderSet.has(placeholder),
  );
  if (missingPlaceholder) {
    throw new Error(`Unmapped placeholder detected: ${missingPlaceholder}`);
  }

  template.mappings = cleaned as any;
  if (params.watermarkText !== undefined) {
    template.watermarkText = sanitizeWatermarkText(params.watermarkText);
  }
  if (params.watermarkFontSizePt !== undefined) {
    template.watermarkFontSizePt = sanitizeWatermarkFontSizePt(
      params.watermarkFontSizePt,
    );
  }
  template.updatedBy = new Types.ObjectId(params.adminId);
  const saved = await template.save();
  return toTemplateResponse(saved.toObject());
};

// Load the active template for a permit and scope.
export const getActivePermitTemplateS = async (
  permitId: string,
  templateScope: PermitTemplateScopeType = DEFAULT_TEMPLATE_SCOPE,
) => {
  if (!Types.ObjectId.isValid(permitId)) return null;
  const template = await PermitTemplate.findOne({
    status: "active",
    linkedPermitId: permitId,
    ...buildTemplateScopeFilter(templateScope),
  }).lean();
  if (!template) return null;
  return toTemplateResponse(template);
};

// Check whether an application has an active template available for generation.
// This mirrors generation lookup rules without mutating application state.
export const hasActiveTemplateForApplicationS = async (params: {
  applicationId: string;
  mode?: DocumentGenerationMode;
}) => {
  const mode: DocumentGenerationMode = params.mode ?? "permit";
  const templateScope: PermitTemplateScopeType =
    mode === "inspection_certificate" ? "inspection_certificate" : "permit";

  if (!Types.ObjectId.isValid(params.applicationId)) return false;

  const application = await PermitApplication.findById(params.applicationId)
    .populate("permit", "name")
    .select("permit permitName")
    .lean();
  if (!application) return false;

  const applicationPermitId = toCanonicalObjectId(application.permit);
  const applicationPermitName =
    normalizeText((application.permit as any)?.name) ||
    normalizeText((application as any).permitName);

  let activeTemplate = applicationPermitId
    ? await PermitTemplate.findOne({
        status: "active",
        linkedPermitId: applicationPermitId,
        ...buildTemplateScopeFilter(templateScope),
      })
        .select("_id")
        .lean()
    : null;

  // Keep fallback behavior aligned with generation for stale permit references.
  if (!activeTemplate && applicationPermitName) {
    const byName = await PermitTemplate.find({
      status: "active",
      linkedPermitName: applicationPermitName,
      ...buildTemplateScopeFilter(templateScope),
    })
      .select("_id")
      .lean();
    if (byName.length === 1) {
      activeTemplate = byName[0];
    }
  }

  return Boolean(activeTemplate);
};

// Render the active template into a generated permit or certificate document.
export const generatePermitDocumentS = async (params: {
  applicationId: string;
  adminId: string;
  mode?: DocumentGenerationMode;
}) => {
  const mode: DocumentGenerationMode = params.mode ?? "permit";
  const targetKey: GeneratedTargetKey =
    mode === "inspection_certificate"
      ? "generatedInspectionCertificate"
      : "generatedPermit";
  const isInspectionMode = mode === "inspection_certificate";
  const templateScope: PermitTemplateScopeType = isInspectionMode
    ? "inspection_certificate"
    : "permit";
  const notIssuableErrorMessage = isInspectionMode
    ? "This inspection record is not issuable for certificate generation."
    : "This record is not approved or not yet issuable for permit generation.";

  if (!Types.ObjectId.isValid(params.applicationId)) return null;
  if (!Types.ObjectId.isValid(params.adminId)) return null;

  const application = await PermitApplication.findById(params.applicationId)
    .populate("permit", "name fields")
    .exec();
  if (!application) return null;

  const applicationPermitId = toCanonicalObjectId(application.permit);
  const applicationPermitName =
    normalizeText((application.permit as any)?.name) ||
    normalizeText(application.permitName);

  let activeTemplate = applicationPermitId
    ? await PermitTemplate.findOne({
        status: "active",
        linkedPermitId: applicationPermitId,
        ...buildTemplateScopeFilter(templateScope),
      }).exec()
    : null;

  // Fallback for legacy/stale permit references: resolve by linked permit name.
  if (!activeTemplate && applicationPermitName) {
    const byName = await PermitTemplate.find({
      status: "active",
      linkedPermitName: applicationPermitName,
      ...buildTemplateScopeFilter(templateScope),
    }).exec();
    if (byName.length === 1) {
      activeTemplate = byName[0];
    }
  }

  if (!activeTemplate) {
    throw new Error(
      "No active template found for this permit. Please activate a matching template.",
    );
  }
  const linkedPermitId = toCanonicalObjectId(activeTemplate.linkedPermitId);
  if (
    applicationPermitId &&
    linkedPermitId &&
    linkedPermitId !== applicationPermitId
  ) {
    throw new Error(
      "Template and application permit mismatch. Use a template linked to the same permit.",
    );
  }
  const isInspectionStageIssuable =
    application.currentStage === "inspector_inspection_request" ||
    application.currentStage === "admin_permit_approval";
  if (
    (isInspectionMode && !isInspectionStageIssuable) ||
    (!isInspectionMode &&
      (application.status !== "approved" ||
        application.currentStage !== "admin_permit_validity"))
  ) {
    throw new Error(notIssuableErrorMessage);
  }

  const placeholders = Array.isArray(activeTemplate.placeholders)
    ? activeTemplate.placeholders
    : [];
  const mappings = (activeTemplate.mappings ??
    []) as PermitTemplatePlaceholderMappingType[];
  const { entries } = await getDocxTextEntries(activeTemplate.contentBase64);
  const pageSourceXml =
    entries.find((entry) => entry.name === "word/document.xml")?.xml ??
    entries[0]?.xml ??
    "";
  const pageSizeMm = pageSourceXml
    ? extractDocxPageSizeMm(pageSourceXml)
    : null;

  ensureTemplateMappings(placeholders, mappings);

  const resolvedValues: Record<string, string> = {};
  let hasAutoIncrementStateChanges = false;
  const now = new Date();
  const existingResolvedValues =
    ((application as any)?.[targetKey]?.resolvedValues as
      | Record<string, string>
      | undefined) ?? {};
  const autoIncrementStates = Array.isArray(
    (activeTemplate as any).autoIncrementStates,
  )
    ? ((activeTemplate as any).autoIncrementStates as any[]).map((state) => ({
        ...state,
      }))
    : [];
  const templateSnapshotUpdatedAt = activeTemplate.updatedAt
    ? new Date(activeTemplate.updatedAt).getTime()
    : 0;

  for (const placeholder of placeholders) {
    const mapping = mappings.find((item) => item.placeholder === placeholder);
    if (!mapping) {
      throw new Error(`Unmapped placeholder detected: ${placeholder}`);
    }

    let value = "";
    if (mapping.sourceType === "system") {
      value = getSystemValue({
        sourceKey: mapping.sourceKey,
        application,
      });
    } else if (mapping.sourceType === "field") {
      value = resolveFieldValue({
        application,
        sourceKey: mapping.sourceKey,
      });
    } else if (mapping.sourceType === "fixed_value") {
      value = normalizeText((mapping as any).fixedValue);
    } else if (mapping.sourceType === "auto_increment") {
      const alreadyAssigned = normalizeText(
        existingResolvedValues[placeholder],
      );
      if (alreadyAssigned) {
        value = alreadyAssigned;
      } else {
        const config = (mapping as any).autoIncrement ?? {};
        const prefix = resolveDateTokens(normalizeText(config.prefix), now);
        const suffix = resolveDateTokens(
          normalizeAutoIncrementSuffix(config.suffix),
          now,
        );
        const paddingLength = Number(config.paddingLength ?? 4);
        const safePadding =
          Number.isInteger(paddingLength) &&
          paddingLength >= 1 &&
          paddingLength <= 12
            ? paddingLength
            : 4;
        const resetRule = YEARLY_RESET_RULE;
        const periodKey = getCounterPeriodKey(resetRule, now);

        let state = autoIncrementStates.find(
          (item) => normalizeText(item?.placeholder) === placeholder,
        );
        if (!state) {
          state = {
            placeholder,
            lastPeriodKey: periodKey,
            currentValue: 0,
            updatedAt: now,
          };
          autoIncrementStates.push(state);
        }

        if (normalizeText(state.lastPeriodKey) !== periodKey) {
          state.lastPeriodKey = periodKey;
          state.currentValue = 0;
        }

        const nextSequence = Number(state.currentValue ?? 0) + 1;
        state.currentValue = nextSequence;
        state.updatedAt = now;
        hasAutoIncrementStateChanges = true;

        value = `${prefix}${String(nextSequence).padStart(safePadding, "0")}${suffix}`;
        state.lastAssignedValue = value;
      }
    }

    if (!normalizeText(value)) {
      throw new Error(`Missing approved value for placeholder: ${placeholder}`);
    }

    resolvedValues[placeholder] = value;
  }

  const contentBase64 = await renderDocx({
    contentBase64: activeTemplate.contentBase64,
    resolvedValues,
  });
  const generatedAt = new Date();
  const docxBuffer = Buffer.from(contentBase64, "base64");
  let clearPdfBase64 = "";
  let watermarkedPdfBase64 = "";
  const watermarkText = sanitizeWatermarkText(activeTemplate.watermarkText);
  const watermarkFontSizePt = sanitizeWatermarkFontSizePt(
    activeTemplate.watermarkFontSizePt,
  );

  try {
    const clearPdfBuffer = await convertDocxBufferToPdfBuffer(docxBuffer);
    const watermarkedPdfBuffer = await buildWatermarkedPdfFromClearPdf({
      clearPdfBuffer,
      watermarkText,
      watermarkFontSizePt,
    });
    clearPdfBase64 = clearPdfBuffer.toString("base64");
    watermarkedPdfBase64 = watermarkedPdfBuffer.toString("base64");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown conversion error";
    throw new Error(`Server DOCX-to-PDF conversion failed: ${message}`);
  }

  const generatedPreview = placeholders
    .map((placeholder) => `${placeholder}: ${resolvedValues[placeholder]}`)
    .join("\n");

  const generated = await runInTransaction(async (session) => {
    const applicationToUpdate = await PermitApplication.findById(
      params.applicationId,
    ).session(session);
    if (!applicationToUpdate) return null;

    const isInspectionStageIssuableInTxn =
      applicationToUpdate.currentStage === "inspector_inspection_request" ||
      applicationToUpdate.currentStage === "admin_permit_approval";
    if (
      (isInspectionMode && !isInspectionStageIssuableInTxn) ||
      (!isInspectionMode &&
        (applicationToUpdate.status !== "approved" ||
          applicationToUpdate.currentStage !== "admin_permit_validity"))
    ) {
      throw new Error(notIssuableErrorMessage);
    }

    const templateToUpdate = await PermitTemplate.findOne({
      _id: String(activeTemplate._id),
      ...buildTemplateScopeFilter(templateScope),
    }).session(session);
    if (!templateToUpdate) {
      throw new Error(
        "No active template found for this permit. Please activate a matching template.",
      );
    }

    if (hasAutoIncrementStateChanges) {
      const latestTemplateUpdatedAt = templateToUpdate.updatedAt
        ? new Date(templateToUpdate.updatedAt).getTime()
        : 0;
      if (latestTemplateUpdatedAt !== templateSnapshotUpdatedAt) {
        throw new Error(
          "Template counters changed while generating. Please retry generation.",
        );
      }
      (templateToUpdate as any).autoIncrementStates = autoIncrementStates;
      await templateToUpdate.save({ session });
    }

    const generatedSnapshot = {
      templateId: String(activeTemplate._id),
      templateName: activeTemplate.name,
      templateVersion: Number(activeTemplate.version ?? 1),
      placeholders,
      resolvedValues,
      generatedPreview,
      status: "generated",
      generatedBy: new Types.ObjectId(params.adminId),
      confirmedBy: null,
      confirmedAt: null,
      sentToApplicantBy: isInspectionMode
        ? new Types.ObjectId(params.adminId)
        : null,
      sentToApplicantAt: isInspectionMode ? generatedAt : null,
      file: {
        fileName: `${normalizeText(activeTemplate.name).replace(/\s+/g, "_") || (isInspectionMode ? "inspection_certificate" : "permit")}_${String(applicationToUpdate._id)}.docx`,
        mimeType: DOCX_MIME_TYPE,
        contentBase64,
        generatedAt,
        watermarkText,
        watermarkFontSizePt,
        pdf: {
          mimeType: PDF_MIME_TYPE,
          clearContentBase64: clearPdfBase64,
          watermarkedContentBase64: watermarkedPdfBase64,
          generatedAt,
        },
        pageSizeMm,
      },
    } as any;
    (applicationToUpdate as any)[targetKey] = generatedSnapshot;
    if (isInspectionMode) {
      // Inspection certificates are considered immediately sent to owners.
      applicationToUpdate.ownerStatusVersion =
        Number(applicationToUpdate.ownerStatusVersion ?? 0) + 1;
      applicationToUpdate.ownerStatusSource = "system";
    }

    const saved = await applicationToUpdate.save({ session });
    return (saved as any)[targetKey];
  });

  return generated
    ? {
        templateName: generated.templateName,
        templateVersion: generated.templateVersion,
        generatedPreview: generated.generatedPreview,
        status: generated.status,
        file: {
          fileName: generated.file.fileName,
          mimeType: generated.file.mimeType,
          contentBase64: generated.file.contentBase64,
          generatedAt: generated.file.generatedAt,
          watermarkText: generated.file.watermarkText,
          watermarkFontSizePt: Number(generated.file.watermarkFontSizePt ?? 48),
          pdf: generated.file.pdf ?? null,
          pageSizeMm: generated.file.pageSizeMm ?? null,
        },
      }
    : null;
};

// Return the generated permit snapshot for an application.
export const getGeneratedPermitDocumentS = async (applicationId: string) => {
  if (!Types.ObjectId.isValid(applicationId)) return null;
  const application = await PermitApplication.findById(applicationId)
    .select("generatedPermit")
    .lean();
  if (!application) return null;
  return application.generatedPermit ?? null;
};

const buildTemplateScopeFilter = (scope: PermitTemplateScopeType) => {
  if (scope === "permit") {
    return {
      $or: [{ templateScope: "permit" }, { templateScope: { $exists: false } }],
    };
  }

  return { templateScope: scope };
};

// Return the generated inspection certificate snapshot for an application.
export const getGeneratedInspectionCertificateDocumentS = async (
  applicationId: string,
) => {
  if (!Types.ObjectId.isValid(applicationId)) return null;
  const application = await PermitApplication.findById(applicationId)
    .select("generatedInspectionCertificate")
    .lean();
  if (!application) return null;
  return (application as any).generatedInspectionCertificate ?? null;
};

// Mark a generated permit as sent to the applicant.
export const sendGeneratedPermitToApplicantS = async (params: {
  applicationId: string;
  adminId: string;
}) => {
  if (!Types.ObjectId.isValid(params.applicationId)) return null;
  if (!Types.ObjectId.isValid(params.adminId)) return null;

  const sent = await runInTransaction(async (session) => {
    const application = await PermitApplication.findById(
      params.applicationId,
    ).session(session);
    if (!application) return null;

    if (!application.generatedPermit?.file?.pdf?.watermarkedContentBase64) {
      throw new Error(
        "No generated permit found for this application. Generate a permit first.",
      );
    }

    if (application.generatedPermit.sentToApplicantAt) {
      const existing = application.generatedPermit as any;
      return {
        templateName: normalizeText(existing?.templateName),
        templateVersion: Number(existing?.templateVersion ?? 0),
        status: normalizeText(existing?.status) || "generated",
        sentToApplicantAt: existing?.sentToApplicantAt ?? null,
        file: {
          fileName: normalizeText(existing?.file?.fileName),
          mimeType: normalizeText(existing?.file?.mimeType),
          generatedAt: existing?.file?.generatedAt ?? null,
          pdf: existing?.file?.pdf
            ? {
                mimeType: normalizeText(existing?.file?.pdf?.mimeType),
                generatedAt: existing?.file?.pdf?.generatedAt ?? null,
              }
            : null,
        },
      };
    }

    application.currentStage = "business_owner_application_status";
    application.destinationModule = "business_owner_application_status";
    application.ownerStatusVersion =
      Number(application.ownerStatusVersion ?? 0) + 1;
    application.ownerStatusSource = "system";
    application.generatedPermit.sentToApplicantBy = new Types.ObjectId(
      params.adminId,
    );
    application.generatedPermit.sentToApplicantAt = new Date();

    await OwnerApplicationStatus.create(
      [
        {
          permit: application.permit,
          application: application._id,
          applicant: application.applicant,
          permitName: application.permitName,
          status: "approved",
          statusSource: "system",
          adminRemark:
            "Your permit is complete and ready for download from Application Status.",
        },
      ],
      { session },
    );

    const saved = await application.save({ session });
    const generated = saved.generatedPermit as any;
    return {
      templateName: normalizeText(generated?.templateName),
      templateVersion: Number(generated?.templateVersion ?? 0),
      status: normalizeText(generated?.status) || "generated",
      sentToApplicantAt: generated?.sentToApplicantAt ?? null,
      file: {
        fileName: normalizeText(generated?.file?.fileName),
        mimeType: normalizeText(generated?.file?.mimeType),
        generatedAt: generated?.file?.generatedAt ?? null,
        pdf: generated?.file?.pdf
          ? {
              mimeType: normalizeText(generated?.file?.pdf?.mimeType),
              generatedAt: generated?.file?.pdf?.generatedAt ?? null,
            }
          : null,
      },
    };
  });

  return sent;
};
