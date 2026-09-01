import OwnerApplicationStatus from "@/models/owner_application_status/owner-application-status.model";
import PermitApplication from "@/models/permit_application/permit-application.model";
import { Types } from "mongoose";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const normalizeText = (value: unknown) => String(value ?? "").trim();

// Describe inspector workflow audit query inputs.
type GetInspectorWorkflowAuditParams = {
  inspectorId: string;
  inspectorName?: string;
  page: number;
  limit: number;
  permit?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
};

type InspectorWorkflowAuditCursorRow = {
  _id: unknown;
  application?: unknown;
  applicant?: unknown;
  permitName?: string;
  status?: string;
  inspectionRemark?: string;
  createdAt?: Date | null;
  submittedAt?: Date | null;
};

type InspectorWorkflowAuditEventRow = {
  _id: string;
  applicationId: string;
  permitName: string;
  applicantName: string;
  statusCode: string;
  source: "inspector";
  actorName: string;
  remark: string;
  occurredAt: Date | null;
};

const INSPECTOR_ALLOWED_STATUSES = new Set(["inspection_passed"]);

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const SEARCH_DATE_FORMATTER = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Manila",
});

const SEARCH_DATE_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const normalizeLabel = (value: string) =>
  normalizeText(value)
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const buildApplicantName = (applicant: any) => {
  // Build a readable applicant name for audit output.
  const firstName = normalizeText(applicant?.firstName);
  const middleName = normalizeText(applicant?.middleName);
  const lastName = normalizeText(applicant?.lastName);
  const suffix = normalizeText(applicant?.suffix);
  const applicantName = [firstName, middleName, lastName]
    .filter(Boolean)
    .join(" ");

  return suffix
    ? `${applicantName} ${suffix}`.trim()
    : applicantName || "Unknown Applicant";
};

const buildDateSearchStrings = (value: Date | null) => {
  // Generate searchable date variants for local time.
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return [];

  const parts = new Map(
    SEARCH_DATE_PARTS_FORMATTER.formatToParts(value).map((part) => [
      part.type,
      part.value,
    ]),
  );

  const year = parts.get("year") ?? "";
  const month = parts.get("month") ?? "";
  const day = parts.get("day") ?? "";
  const hour = parts.get("hour") ?? "";
  const minute = parts.get("minute") ?? "";

  return [
    SEARCH_DATE_FORMATTER.format(value),
    year && month && day && hour && minute
      ? `${year}-${month}-${day} ${hour}:${minute}`
      : "",
    year && month && day && hour && minute
      ? `${month}/${day}/${year} ${hour}:${minute}`
      : "",
  ].filter(Boolean);
};

const buildSearchHaystack = (row: InspectorWorkflowAuditEventRow) =>
  [
    ...buildDateSearchStrings(row.occurredAt),
    normalizeLabel(row.statusCode),
    row.statusCode,
    normalizeLabel(row.source),
    row.source,
    row.actorName,
    row.permitName,
    row.applicantName,
    row.remark,
  ]
    .join("\n")
    .toLowerCase();

const formatAuditDateTime = (value: Date | null) => {
  // Format timestamps for audit table and PDF output.
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "-";
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
};

const wrapTextByWidth = (
  value: string,
  maxWidth: number,
  font: any,
  fontSize: number,
) => {
  // Wrap PDF text so rows fit within the available width.
  const text = normalizeText(value) || "-";
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return ["-"];

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const candidateWidth = font.widthOfTextAtSize(candidate, fontSize);

    if (candidateWidth <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
      current = "";
    }

    if (font.widthOfTextAtSize(word, fontSize) <= maxWidth) {
      current = word;
      continue;
    }

    let chunk = "";
    for (const char of word) {
      const testChunk = `${chunk}${char}`;
      if (font.widthOfTextAtSize(testChunk, fontSize) <= maxWidth) {
        chunk = testChunk;
      } else {
        if (chunk) lines.push(chunk);
        chunk = char;
      }
    }
    current = chunk;
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : ["-"];
};

const buildBaseMatch = (params: {
  applicationIds: string[];
  permit?: string;
  dateFrom?: string;
  dateTo?: string;
}) => {
  // Build the shared query filter for inspector audit lookups.
  const match: Record<string, any> = {
    deletedAt: null,
    statusSource: "inspector",
    status: { $in: [...INSPECTOR_ALLOWED_STATUSES] },
    application: { $in: params.applicationIds },
  };

  const dateFrom = normalizeText(params.dateFrom);
  const dateTo = normalizeText(params.dateTo);
  if (dateFrom || dateTo) {
    const createdAt: Record<string, Date> = {};
    if (dateFrom) {
      const from = new Date(dateFrom);
      if (!Number.isNaN(from.getTime())) createdAt.$gte = from;
    }
    if (dateTo) {
      const to = new Date(dateTo);
      if (!Number.isNaN(to.getTime())) {
        to.setHours(23, 59, 59, 999);
        createdAt.$lte = to;
      }
    }
    if (Object.keys(createdAt).length > 0) {
      match.createdAt = createdAt;
    }
  }

  const permit = normalizeText(params.permit);
  if (permit) {
    match.permitName = { $regex: `^${escapeRegExp(permit)}$`, $options: "i" };
  }

  return match;
};

const collectLatestInspectorWorkflowStatusIds = async (params: {
  match: Record<string, any>;
  skip: number;
  limit: number;
  collectAll?: boolean;
}) => {
  // Select the latest status per application for audit reporting.
  const seenApplications = new Set<string>();
  const ids: string[] = [];
  let total = 0;

  const cursor = OwnerApplicationStatus.find(params.match)
    .select("_id application")
    .sort({ createdAt: -1, _id: -1 })
    .lean()
    .cursor();

  try {
    for await (const row of cursor as AsyncIterable<InspectorWorkflowAuditCursorRow>) {
      const applicationKey = String(row.application ?? row._id ?? "");
      if (!applicationKey || seenApplications.has(applicationKey)) continue;

      seenApplications.add(applicationKey);
      total += 1;

      if (params.collectAll) {
        ids.push(String(row._id ?? ""));
        continue;
      }

      if (total <= params.skip) continue;
      if (ids.length < params.limit) {
        ids.push(String(row._id ?? ""));
      }
    }
  } finally {
    await cursor.close();
  }

  return { ids, total };
};

const hydrateInspectorWorkflowAuditEvents = async (
  latestStatusIds: string[],
  inspectorName: string,
): Promise<InspectorWorkflowAuditEventRow[]> => {
  // Populate and shape inspector audit rows for the response.
  if (latestStatusIds.length === 0) return [];

  const orderMap = new Map(
    latestStatusIds.map((id, index) => [String(id), index]),
  );

  const rows = await OwnerApplicationStatus.find({
    _id: { $in: latestStatusIds },
  })
    .populate("applicant", "firstName middleName lastName suffix")
    .sort({ createdAt: -1, _id: -1 })
    .lean();

  return rows
    .map((row: any) => ({
      _id: String(row._id),
      applicationId: String(row.application ?? ""),
      permitName: normalizeText(row.permitName) || "Unknown Permit",
      applicantName: buildApplicantName(row.applicant),
      statusCode: normalizeText(row.status),
      source: "inspector" as const,
      actorName: inspectorName || "Inspector",
      remark: normalizeText(row.inspectionRemark),
      occurredAt: row.createdAt ?? row.submittedAt ?? null,
    }))
    .sort(
      (left, right) =>
        (orderMap.get(left._id) ?? Number.MAX_SAFE_INTEGER) -
        (orderMap.get(right._id) ?? Number.MAX_SAFE_INTEGER),
    );
};

export const getInspectorWorkflowAuditEventsS = async (
  params: GetInspectorWorkflowAuditParams,
) => {
  // Return paginated inspector workflow audit results.
  if (!Types.ObjectId.isValid(params.inspectorId)) {
    return {
      data: [],
      pagination: {
        page: Math.max(1, Number(params.page || 1)),
        limit: Math.min(100, Math.max(1, Number(params.limit || 20))),
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      },
    };
  }

  const page = Math.max(1, Number(params.page || 1));
  const limit = Math.min(100, Math.max(1, Number(params.limit || 20)));
  const skip = (page - 1) * limit;
  const inspectorObjectId = new Types.ObjectId(params.inspectorId);

  const assignedApplications = await PermitApplication.find({
    "inspectionFlow.steps.assignedInspector": inspectorObjectId,
  })
    .select("_id")
    .lean();

  const applicationIds = assignedApplications.map((application: any) =>
    String(application._id),
  );

  if (applicationIds.length === 0) {
    return {
      data: [],
      pagination: {
        page,
        limit,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: page > 1,
      },
    };
  }

  const match = buildBaseMatch({
    applicationIds,
    permit: params.permit,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
  });

  const permitOptionsPromise = OwnerApplicationStatus.distinct("permitName", {
    deletedAt: null,
    statusSource: "inspector",
    status: { $in: [...INSPECTOR_ALLOWED_STATUSES] },
    application: { $in: applicationIds },
  }).then((values) => {
    const uniquePermits = new Map<string, string>();

    values
      .map((value) => normalizeText(value))
      .filter(Boolean)
      .forEach((value) => {
        const key = value.toLowerCase();
        if (key === "all") return;
        if (!uniquePermits.has(key)) {
          uniquePermits.set(key, value);
        }
      });

    return Array.from(uniquePermits.values()).sort((a, b) =>
      a.localeCompare(b),
    );
  });

  const search = normalizeText(params.search).toLowerCase();
  const shouldFilterBySearch = search.length > 0;
  const { ids: latestStatusIds, total } =
    await collectLatestInspectorWorkflowStatusIds({
      match,
      skip: shouldFilterBySearch ? 0 : skip,
      limit,
      collectAll: shouldFilterBySearch,
    });

  if (latestStatusIds.length === 0) {
    const permitOptions = await permitOptionsPromise;
    return {
      data: [],
      permits: permitOptions,
      pagination: {
        page,
        limit,
        total: shouldFilterBySearch ? 0 : total,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: page > 1,
      },
    };
  }

  const hydratedRows = await hydrateInspectorWorkflowAuditEvents(
    latestStatusIds,
    normalizeText(params.inspectorName) || "Inspector",
  );
  const filteredRows = shouldFilterBySearch
    ? hydratedRows.filter((row) => buildSearchHaystack(row).includes(search))
    : hydratedRows;
  const paginatedRows = shouldFilterBySearch
    ? filteredRows.slice(skip, skip + limit)
    : filteredRows;
  const filteredTotal = shouldFilterBySearch ? filteredRows.length : total;
  const permitOptions = await permitOptionsPromise;

  return {
    data: paginatedRows,
    permits: permitOptions,
    pagination: {
      page,
      limit,
      total: filteredTotal,
      totalPages: Math.max(1, Math.ceil(filteredTotal / limit)),
      hasNextPage: page * limit < filteredTotal,
      hasPrevPage: page > 1,
    },
  };
};

export const downloadInspectorWorkflowAuditPdfS = async (
  params: Omit<GetInspectorWorkflowAuditParams, "page" | "limit">,
) => {
  const rows: InspectorWorkflowAuditEventRow[] = [];
  let page = 1;
  let hasNext = true;

  while (hasNext) {
    const result = await getInspectorWorkflowAuditEventsS({
      ...params,
      page,
      limit: 100,
    });

    rows.push(...(result.data as InspectorWorkflowAuditEventRow[]));
    hasNext = Boolean(result.pagination?.hasNextPage);
    page += 1;
  }

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 842;
  const pageHeight = 595;
  let pdfPage = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - 36;
  const left = 32;

  const drawHeader = () => {
    pdfPage.drawText("Inspector Workflow History", {
      x: left,
      y,
      size: 15,
      font: bold,
      color: rgb(0.06, 0.16, 0.26),
    });
    y -= 18;
    pdfPage.drawText(`Generated: ${new Date().toLocaleString("en-PH")}`, {
      x: left,
      y,
      size: 9,
      font,
      color: rgb(0.32, 0.36, 0.43),
    });
    y -= 14;
    const scopeTags: string[] = [];
    if (normalizeText(params.permit))
      scopeTags.push(`Permit: ${normalizeText(params.permit)}`);
    if (normalizeText(params.search))
      scopeTags.push(`Search: ${normalizeText(params.search)}`);
    if (normalizeText(params.dateFrom))
      scopeTags.push(`From: ${normalizeText(params.dateFrom)}`);
    if (normalizeText(params.dateTo))
      scopeTags.push(`To: ${normalizeText(params.dateTo)}`);
    pdfPage.drawText(
      `Scope: ${scopeTags.length > 0 ? scopeTags.join(" | ") : "No filters applied (all records)"}`,
      {
        x: left,
        y,
        size: 9,
        font,
        color: rgb(0.32, 0.36, 0.43),
      },
    );
    y -= 18;

    const headers = [
      { label: "When", x: left },
      { label: "Status", x: 210 },
      { label: "Actor", x: 355 },
      { label: "Permit", x: 530 },
      { label: "Applicant", x: 665 },
    ];
    headers.forEach((header) => {
      pdfPage.drawText(header.label, {
        x: header.x,
        y,
        size: 9,
        font: bold,
        color: rgb(0.06, 0.16, 0.26),
      });
    });
    y -= 12;
    pdfPage.drawLine({
      start: { x: left, y },
      end: { x: pageWidth - left, y },
      thickness: 0.7,
      color: rgb(0.82, 0.85, 0.9),
    });
    y -= 10;
  };

  drawHeader();

  if (rows.length === 0) {
    pdfPage.drawText("No records found for the selected filter scope.", {
      x: left,
      y,
      size: 10,
      font,
      color: rgb(0.32, 0.36, 0.43),
    });
  }

  for (const row of rows) {
    if (y < 36) {
      pdfPage = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - 36;
      drawHeader();
    }

    const fontSize = 9;
    const lineHeight = 11;
    const columns = [
      {
        x: left,
        width: 170,
        lines: wrapTextByWidth(
          formatAuditDateTime(row.occurredAt),
          170,
          font,
          fontSize,
        ),
      },
      {
        x: 210,
        width: 140,
        lines: wrapTextByWidth(
          normalizeLabel(row.statusCode),
          140,
          font,
          fontSize,
        ),
      },
      {
        x: 355,
        width: 170,
        lines: wrapTextByWidth(row.actorName, 170, font, fontSize),
      },
      {
        x: 530,
        width: 130,
        lines: wrapTextByWidth(row.permitName, 130, font, fontSize),
      },
      {
        x: 665,
        width: 145,
        lines: wrapTextByWidth(row.applicantName, 145, font, fontSize),
      },
    ];

    const maxLines = Math.max(...columns.map((column) => column.lines.length));
    const rowHeight = maxLines * lineHeight + 2;

    if (y - rowHeight < 36) {
      pdfPage = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - 36;
      drawHeader();
    }

    columns.forEach((column) => {
      column.lines.forEach((line, index) => {
        pdfPage.drawText(line, {
          x: column.x,
          y: y - index * lineHeight,
          size: fontSize,
          font,
          color: rgb(0.11, 0.13, 0.17),
        });
      });
    });

    y -= rowHeight;
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
};
