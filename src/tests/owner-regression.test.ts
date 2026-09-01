import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import dotenv from "dotenv";
import mongoose from "mongoose";

type JsonValue = Record<string, any> | any[] | string | number | boolean | null;

type ApiResponse = {
  status: number;
  headers: Headers;
  body: JsonValue;
  buffer?: Buffer;
};

const nativeFetch = global.fetch.bind(globalThis);

process.env.NODE_ENV = "test";
dotenv.config({
  path: path.resolve(process.cwd(), ".env"),
});

// Seed required test environment variables when values are missing.
const setEnvDefault = (key: string, fallback: string) => {
  process.env[key] = process.env[key]?.trim() || fallback;
};

setEnvDefault("PORT", "5002");
setEnvDefault("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173");
setEnvDefault(
  "MONGO_DB_URI",
  "mongodb://127.0.0.1:27017/bplo_owner_regression",
);
setEnvDefault("JWT_ACCESS_TOKEN", "owner-regression-access-secret");
setEnvDefault("JWT_REFRESH_TOKEN", "owner-regression-refresh-secret");

// Run a named async test case and emit PASS/FAIL output.
const runCase = async (name: string, callback: () => Promise<void>) => {
  try {
    await callback();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
};

class TestClient {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken?: string,
  ) {}

  // Send an HTTP request with optional bearer token and JSON body.
  async request({
    method,
    path: requestPath,
    accessToken,
    body,
    expectBinary = false,
  }: {
    method: string;
    path: string;
    accessToken?: string;
    body?: Record<string, unknown>;
    expectBinary?: boolean;
  }): Promise<ApiResponse> {
    const headers = new Headers();
    const resolvedAccessToken = accessToken ?? this.accessToken;

    if (resolvedAccessToken) {
      headers.set("authorization", `Bearer ${resolvedAccessToken}`);
    }

    let payload: string | undefined;
    if (body !== undefined) {
      headers.set("content-type", "application/json");
      payload = JSON.stringify(body);
    }

    const response = await nativeFetch(`${this.baseUrl}${requestPath}`, {
      method,
      headers,
      body: payload,
    });

    if (expectBinary) {
      const arrayBuffer = await response.arrayBuffer();

      return {
        status: response.status,
        headers: response.headers,
        body: null,
        buffer: Buffer.from(arrayBuffer),
      };
    }

    const rawText = await response.text();
    const parsedBody = rawText ? (JSON.parse(rawText) as JsonValue) : null;

    return {
      status: response.status,
      headers: response.headers,
      body: parsedBody,
    };
  }
}

// Boot a local Express server wired with owner routes under test.
const createServer = async () => {
  const express = (await import("express")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const mongoSanitize = (await import("../utils/sanitizer/mongo-sanitizer"))
    .default;
  const { globalErrorHandler } =
    await import("../middlewares/global-error-handler.middleware");
  const ownerRouter = (await import("../routes/owner/owner.route")).default;

  const app = express();

  app.use(express.json({ limit: "15mb" }));
  app.use(cookieParser());
  app.use(mongoSanitize);

  app.use("/api/owner", ownerRouter);

  app.use((req, res) => {
    res.status(404).json({
      message: "Route Not Found",
      method: req.method,
      path: req.originalUrl,
    });
  });

  app.use(globalErrorHandler);

  const server = http.createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as AddressInfo | null;
  assert.ok(
    address && typeof address.port === "number",
    "Server did not bind.",
  );

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server,
  };
};

// Gracefully stop the temporary regression server.
const closeServer = async (server: http.Server) => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

// Build the permit field fixture used across owner regression scenarios.
const createPermitFields = () => [
  {
    id: "business_name",
    type: "text",
    label: "Business Name",
    placeholder: "Enter your business name",
    placeholderMode: "manual",
    validation: {
      kind: "none",
      regex: "",
      message: "",
    },
    required: true,
    options: [],
    sectionId: "business_information",
  },
];

// Build the permit section fixture used across owner regression scenarios.
const createPermitSections = () => [
  {
    id: "business_information",
    title: "Business Information",
    layout: "one_column",
  },
];

// Build a minimal owner application response payload.
const createResponses = (value: string) => [
  {
    fieldId: "business_name",
    label: "Business Name",
    type: "text",
    value,
  },
];

// Create generated-document fixtures with clear and watermarked PDF buffers.
const createPdfDocumentSnapshot = (params: {
  label: string;
  generatedBy: any;
  fileName: string;
}) => {
  const watermarkedBuffer = Buffer.from(
    `%PDF-1.4\n${params.label} watermarked\n%%EOF`,
    "utf8",
  );
  const clearBuffer = Buffer.from(
    `%PDF-1.4\n${params.label} clear\n%%EOF`,
    "utf8",
  );

  return {
    snapshot: {
      templateId: `${params.label.toLowerCase().replace(/\s+/g, "-")}-template`,
      templateName: params.label,
      templateVersion: 1,
      placeholders: ["business_name"],
      resolvedValues: {
        business_name: "Regression Business",
      },
      generatedPreview: `${params.label} preview`,
      status: "confirmed",
      generatedBy: params.generatedBy,
      confirmedBy: params.generatedBy,
      confirmedAt: new Date(),
      sentToApplicantBy: params.generatedBy,
      sentToApplicantAt: new Date(),
      file: {
        fileName: params.fileName,
        mimeType: "image/png",
        contentBase64: Buffer.from(
          `${params.label} image content`,
          "utf8",
        ).toString("base64"),
        generatedAt: new Date(),
        watermarkText: "BPLO",
        watermarkFontSizePt: 48,
        pdf: {
          mimeType: "application/pdf",
          clearContentBase64: clearBuffer.toString("base64"),
          watermarkedContentBase64: watermarkedBuffer.toString("base64"),
          generatedAt: new Date(),
        },
      },
    },
    watermarkedBuffer,
  };
};

// Run the full owner-route regression flow.
const main = async () => {
  const initDB = (await import("../db/db.connect")).default;
  const Account = (await import("../models/account/account.model")).default;
  const Permit = (await import("../models/permit/permit.model")).default;
  const PermitApplication = (
    await import("../models/permit_application/permit-application.model")
  ).default;
  const OwnerApplicationStatus = (
    await import("../models/owner_application_status/owner-application-status.model")
  ).default;
  const { signAccessToken } = await import("../utils/jwt/jwt.util");

  const runId = `owner-${Date.now()}`;
  const permitNames = {
    active: `${runId}-active-permit`,
    inactive: `${runId}-inactive-permit`,
  };
  const emails = {
    ownerMain: `${runId}-main-owner@example.com`,
    ownerOther: `${runId}-other-owner@example.com`,
    ownerScope: `${runId}-scope-owner@example.com`,
    ownerResubmit: `${runId}-resubmit-owner@example.com`,
    ownerReassess: `${runId}-reassess-owner@example.com`,
    ownerDocs: `${runId}-docs-owner@example.com`,
    admin: `${runId}-admin@example.com`,
    inspector: `${runId}-inspector@example.com`,
  };

  let server: http.Server | undefined;

  try {
    await initDB();
    assert.equal(
      mongoose.connection.readyState,
      1,
      "MongoDB connection is required for owner regression tests.",
    );

    await OwnerApplicationStatus.deleteMany({
      permitName: { $in: Object.values(permitNames) },
    }).exec();
    await PermitApplication.deleteMany({
      permitName: { $in: Object.values(permitNames) },
    }).exec();
    await Permit.deleteMany({
      name: { $in: Object.values(permitNames) },
    }).exec();
    await Account.deleteMany({
      email: { $in: Object.values(emails) },
    }).exec();

    const accounts = await Account.create([
      {
        firstName: "Main",
        middleName: "",
        lastName: "Owner",
        suffix: "",
        gender: "Prefer not to say",
        email: emails.ownerMain,
        password: "OwnerMain@123",
        role: "business_owner",
        authProvider: "local",
        isVerified: true,
      },
      {
        firstName: "Other",
        middleName: "",
        lastName: "Owner",
        suffix: "",
        gender: "Prefer not to say",
        email: emails.ownerOther,
        password: "OwnerOther@123",
        role: "business_owner",
        authProvider: "local",
        isVerified: true,
      },
      {
        firstName: "Scope",
        middleName: "",
        lastName: "Owner",
        suffix: "",
        gender: "Prefer not to say",
        email: emails.ownerScope,
        password: "OwnerScope@123",
        role: "business_owner",
        authProvider: "local",
        isVerified: true,
      },
      {
        firstName: "Resubmit",
        middleName: "",
        lastName: "Owner",
        suffix: "",
        gender: "Prefer not to say",
        email: emails.ownerResubmit,
        password: "OwnerResubmit@123",
        role: "business_owner",
        authProvider: "local",
        isVerified: true,
      },
      {
        firstName: "Reassess",
        middleName: "",
        lastName: "Owner",
        suffix: "",
        gender: "Prefer not to say",
        email: emails.ownerReassess,
        password: "OwnerReassess@123",
        role: "business_owner",
        authProvider: "local",
        isVerified: true,
      },
      {
        firstName: "Docs",
        middleName: "",
        lastName: "Owner",
        suffix: "",
        gender: "Prefer not to say",
        email: emails.ownerDocs,
        password: "OwnerDocs@123",
        role: "business_owner",
        authProvider: "local",
        isVerified: true,
      },
      {
        firstName: "Owner",
        middleName: "",
        lastName: "Admin",
        suffix: "",
        gender: "Prefer not to say",
        email: emails.admin,
        password: "OwnerAdmin@123",
        role: "super_admin",
        authProvider: "local",
        isVerified: true,
      },
      {
        firstName: "Case",
        middleName: "",
        lastName: "Inspector",
        suffix: "",
        gender: "Prefer not to say",
        email: emails.inspector,
        password: "CaseInspector@123",
        role: "inspector",
        authProvider: "local",
        isVerified: true,
        departmentId: "fire-safety",
        departmentName: "Fire Safety",
      },
    ]);

    const [
      ownerMain,
      ownerOther,
      ownerScope,
      ownerResubmit,
      ownerReassess,
      ownerDocs,
      admin,
      inspector,
    ] = accounts;

    const activePermit = await Permit.create({
      name: permitNames.active,
      description: "Owner regression active permit",
      formTitle: "Regression Permit Form",
      formDescription: "Complete the business owner form.",
      sections: createPermitSections(),
      fields: createPermitFields(),
      isActive: true,
    });

    const inactivePermit = await Permit.create({
      name: permitNames.inactive,
      description: "Owner regression inactive permit",
      formTitle: "Regression Permit Form",
      formDescription: "Complete the business owner form.",
      sections: createPermitSections(),
      fields: createPermitFields(),
      isActive: false,
    });

    const createApplication = async (params: {
      permit: any;
      applicant: any;
      responsesValue: string;
      overrides?: Record<string, unknown>;
    }) =>
      PermitApplication.create({
        permit: params.permit._id,
        applicant: params.applicant._id,
        permitName: params.permit.name,
        formTitle: params.permit.formTitle || params.permit.name,
        responses: createResponses(params.responsesValue),
        status: "submitted",
        tableStatus: "for_review",
        currentStage: "evaluator_application_request",
        destinationModule: "evaluator_application_request",
        submittedAt: new Date(),
        ...(params.overrides ?? {}),
      });

    const createOwnerStatus = async (params: {
      permit: any;
      application: any;
      applicant: any;
      status: string;
      statusSource?: string;
      isRead?: boolean;
      overrides?: Record<string, unknown>;
    }) =>
      OwnerApplicationStatus.create({
        permit: params.permit._id,
        application: params.application._id,
        applicant: params.applicant._id,
        permitName: params.permit.name,
        status: params.status,
        statusSource: params.statusSource ?? "system",
        isRead: params.isRead ?? false,
        submittedAt: new Date(),
        ...(params.overrides ?? {}),
      });

    const otherOwnerApplication = await createApplication({
      permit: activePermit,
      applicant: ownerOther,
      responsesValue: "Other Owner Business",
    });
    const otherOwnerStatus = await createOwnerStatus({
      permit: activePermit,
      application: otherOwnerApplication,
      applicant: ownerOther,
      status: "submitted",
    });

    await createApplication({
      permit: activePermit,
      applicant: ownerOther,
      responsesValue: "Registered Duplicate Business",
      overrides: {
        status: "approved",
        currentStage: "admin_permit_validity",
        destinationModule: "admin_permit_validity",
        adminResult: {
          admin: admin._id,
          decision: "approved",
          remark: "Approved business registration.",
          decidedAt: new Date(),
        },
      },
    });

    const scopeApplication = await createApplication({
      permit: activePermit,
      applicant: ownerScope,
      responsesValue: "Scope Application Business",
    });
    const scopeInspectionApplication = await createApplication({
      permit: activePermit,
      applicant: ownerScope,
      responsesValue: "Scope Inspection Business",
      overrides: {
        currentStage: "inspector_inspection_request",
        destinationModule: "inspector_inspection_request",
      },
    });
    const scopePaymentApplication = await createApplication({
      permit: activePermit,
      applicant: ownerScope,
      responsesValue: "Scope Payment Business",
      overrides: {
        currentStage: "business_owner_application_status",
        destinationModule: "business_owner_application_status",
      },
    });

    const scopeApplicationStatus = await createOwnerStatus({
      permit: activePermit,
      application: scopeApplication,
      applicant: ownerScope,
      status: "submitted",
      statusSource: "system",
    });
    const scopeInspectionStatus = await createOwnerStatus({
      permit: activePermit,
      application: scopeInspectionApplication,
      applicant: ownerScope,
      status: "inspection_pending",
      statusSource: "system",
    });
    const scopePaymentStatus = await createOwnerStatus({
      permit: activePermit,
      application: scopePaymentApplication,
      applicant: ownerScope,
      status: "payment_pending",
      statusSource: "treasurer",
    });

    const resubmitApplication = await createApplication({
      permit: inactivePermit,
      applicant: ownerResubmit,
      responsesValue: "Initial Resubmission Business",
      overrides: {
        status: "submitted",
        tableStatus: "re_submission",
        currentStage: "business_owner_application_status",
        destinationModule: "business_owner_application_status",
        evaluatorResult: {
          evaluator: admin._id,
          decision: "re_submission",
          processDecisions: [],
          remark: "Please update your business name.",
          decidedAt: new Date(),
        },
        ownerStatusVersion: 3,
        ownerStatusReadVersion: 0,
      },
    });
    const resubmitStatus = await createOwnerStatus({
      permit: inactivePermit,
      application: resubmitApplication,
      applicant: ownerResubmit,
      status: "re_submission",
      statusSource: "evaluator",
      overrides: {
        evaluatorRemark: "Please update your business name.",
      },
    });

    const reassessmentApplication = await createApplication({
      permit: activePermit,
      applicant: ownerReassess,
      responsesValue: "Reassessment Business",
      overrides: {
        currentStage: "inspector_inspection_request",
        destinationModule: "inspector_inspection_request",
        inspectionFlow: {
          currentStepIndex: 0,
          steps: [
            {
              processId: "fire-safety",
              processName: "Fire Safety",
              sequence: 1,
              assignedInspector: inspector._id,
              assignedInspectorName: "Case Inspector",
              assignedAt: new Date(),
              scheduledInspectionAt: new Date(),
              scheduleStatus: "scheduled",
              scheduleRemark: "Bring supporting documents.",
              scheduleUpdatedAt: new Date(),
              assessmentResult: "for_completion",
              assessmentRemark: "Add more extinguishers.",
              assessmentSubmittedAt: new Date(),
            },
          ],
        },
      },
    });
    const reassessmentStatus = await createOwnerStatus({
      permit: activePermit,
      application: reassessmentApplication,
      applicant: ownerReassess,
      status: "inspection_for_completion",
      statusSource: "inspector",
      overrides: {
        inspectionRemark: "Add more extinguishers.",
      },
    });

    const generatedPermit = createPdfDocumentSnapshot({
      label: "Business Permit",
      generatedBy: admin._id,
      fileName: "business-permit.png",
    });
    const generatedInspectionCertificate = createPdfDocumentSnapshot({
      label: "Inspection Certificate",
      generatedBy: admin._id,
      fileName: "inspection-certificate.png",
    });
    const generatedDocumentsApplication = await createApplication({
      permit: activePermit,
      applicant: ownerDocs,
      responsesValue: "Generated Documents Business",
      overrides: {
        status: "approved",
        currentStage: "business_owner_application_status",
        destinationModule: "business_owner_application_status",
        generatedPermit: generatedPermit.snapshot,
        generatedInspectionCertificate: generatedInspectionCertificate.snapshot,
      },
    });
    const generatedDocumentsStatus = await createOwnerStatus({
      permit: activePermit,
      application: generatedDocumentsApplication,
      applicant: ownerDocs,
      status: "approved",
      statusSource: "bplo_admin",
      overrides: {
        adminRemark: "Approved and released to applicant.",
      },
    });

    const ownerMainToken = signAccessToken(
      String(ownerMain._id),
      ownerMain.tokenVersion,
    );
    const ownerOtherToken = signAccessToken(
      String(ownerOther._id),
      ownerOther.tokenVersion,
    );
    const ownerScopeToken = signAccessToken(
      String(ownerScope._id),
      ownerScope.tokenVersion,
    );
    const ownerResubmitToken = signAccessToken(
      String(ownerResubmit._id),
      ownerResubmit.tokenVersion,
    );
    const ownerReassessToken = signAccessToken(
      String(ownerReassess._id),
      ownerReassess.tokenVersion,
    );
    const ownerDocsToken = signAccessToken(
      String(ownerDocs._id),
      ownerDocs.tokenVersion,
    );
    const adminToken = signAccessToken(String(admin._id), admin.tokenVersion);

    const runningServer = await createServer();
    server = runningServer.server;

    const ownerMainClient = new TestClient(
      runningServer.baseUrl,
      ownerMainToken,
    );
    const ownerScopeClient = new TestClient(
      runningServer.baseUrl,
      ownerScopeToken,
    );
    const ownerResubmitClient = new TestClient(
      runningServer.baseUrl,
      ownerResubmitToken,
    );
    const ownerReassessClient = new TestClient(
      runningServer.baseUrl,
      ownerReassessToken,
    );
    const ownerDocsClient = new TestClient(
      runningServer.baseUrl,
      ownerDocsToken,
    );
    const adminClient = new TestClient(runningServer.baseUrl, adminToken);

    let submittedApplicationId = "";
    let submittedStatusId = "";

    await runCase("protected owner route rejects non-owner", async () => {
      const response = await adminClient.request({
        method: "GET",
        path: "/api/owner/permits",
      });

      assert.equal(response.status, 403);
      assert.match(
        String((response.body as any)?.message ?? ""),
        /does not have access/i,
      );
    });

    await runCase(
      "permit list hides inactive and direct inactive access is blocked",
      async () => {
        const listResponse = await ownerMainClient.request({
          method: "GET",
          path: "/api/owner/permits",
        });

        assert.equal(listResponse.status, 200);
        const permits = Array.isArray((listResponse.body as any)?.data)
          ? ((listResponse.body as any).data as any[])
          : [];
        assert.ok(
          permits.some(
            (permit) => String(permit._id) === String(activePermit._id),
          ),
        );
        assert.ok(
          permits.every(
            (permit) => String(permit._id) !== String(inactivePermit._id),
          ),
        );

        const activeResponse = await ownerMainClient.request({
          method: "GET",
          path: `/api/owner/permits/${activePermit._id}`,
        });
        assert.equal(activeResponse.status, 200);

        const inactiveResponse = await ownerMainClient.request({
          method: "GET",
          path: `/api/owner/permits/${inactivePermit._id}`,
        });
        assert.equal(inactiveResponse.status, 409);
        assert.match(
          String((inactiveResponse.body as any)?.message ?? ""),
          /no longer available for new applications/i,
        );
      },
    );

    await runCase(
      "new submission works and inactive permit submission is blocked",
      async () => {
        const blockedResponse = await ownerMainClient.request({
          method: "POST",
          path: `/api/owner/permits/${inactivePermit._id}/applications`,
          body: {
            responses: createResponses("Blocked New Business"),
          },
        });

        assert.equal(blockedResponse.status, 409);
        assert.match(
          String((blockedResponse.body as any)?.message ?? ""),
          /no longer available/i,
        );

        const response = await ownerMainClient.request({
          method: "POST",
          path: `/api/owner/permits/${activePermit._id}/applications`,
          body: {
            responses: createResponses("Main Owner Business"),
          },
        });

        assert.equal(response.status, 201);
        assert.equal((response.body as any)?.success, true);
        submittedApplicationId = String(
          (response.body as any)?.data?._id ?? "",
        );
        assert.ok(submittedApplicationId);

        const createdStatus = await OwnerApplicationStatus.findOne({
          application: new mongoose.Types.ObjectId(submittedApplicationId),
          applicant: ownerMain._id,
          status: "submitted",
          deletedAt: null,
        })
          .sort({ createdAt: -1 })
          .lean();

        assert.ok(createdStatus);
        submittedStatusId = String(createdStatus?._id ?? "");
        assert.ok(submittedStatusId);

        const statusesResponse = await ownerMainClient.request({
          method: "GET",
          path: "/api/owner/applications/status",
        });

        assert.equal(statusesResponse.status, 200);
        const statuses = Array.isArray((statusesResponse.body as any)?.data)
          ? ((statusesResponse.body as any).data as any[])
          : [];
        const submittedStatus = statuses.find(
          (status) => String(status._id) === submittedStatusId,
        );

        assert.ok(submittedStatus);
        assert.equal(submittedStatus.applicationRefId, submittedApplicationId);
        assert.equal(submittedStatus.status, "submitted");
      },
    );

    await runCase(
      "submission blocks duplicate business names that are already registered",
      async () => {
        const duplicateResponse = await ownerMainClient.request({
          method: "POST",
          path: `/api/owner/permits/${activePermit._id}/applications`,
          body: {
            responses: createResponses("  Registered   Duplicate Business "),
          },
        });

        assert.equal(duplicateResponse.status, 409);
        assert.match(
          String((duplicateResponse.body as any)?.message ?? ""),
          /already registered/i,
        );
      },
    );

    await runCase("mark-as-read is owner-scoped", async () => {
      const ownReadResponse = await ownerMainClient.request({
        method: "PATCH",
        path: `/api/owner/applications/${submittedStatusId}/read`,
      });

      assert.equal(ownReadResponse.status, 200);
      assert.equal((ownReadResponse.body as any)?.success, true);

      const ownStatusAfterRead = await OwnerApplicationStatus.findById(
        submittedStatusId,
      )
        .select("isRead")
        .lean();
      assert.equal(ownStatusAfterRead?.isRead, true);

      const deniedResponse = await ownerMainClient.request({
        method: "PATCH",
        path: `/api/owner/applications/${otherOwnerStatus._id}/read`,
      });

      assert.equal(deniedResponse.status, 404);

      const foreignStatusAfterAttempt = await OwnerApplicationStatus.findById(
        otherOwnerStatus._id,
      )
        .select("isRead")
        .lean();
      assert.equal(foreignStatusAfterAttempt?.isRead, false);

      const otherOwnerAccess = await new TestClient(
        runningServer.baseUrl,
        ownerOtherToken,
      ).request({
        method: "PATCH",
        path: `/api/owner/applications/${otherOwnerStatus._id}/read`,
      });

      assert.equal(otherOwnerAccess.status, 200);
    });

    await runCase(
      "mark-all read with application scope leaves inspection and payment unread",
      async () => {
        await OwnerApplicationStatus.updateMany(
          { applicant: ownerScope._id },
          { $set: { isRead: false } },
        ).exec();

        const response = await ownerScopeClient.request({
          method: "PATCH",
          path: "/api/owner/applications/read-all",
          body: {
            scope: "application",
          },
        });

        assert.equal(response.status, 200);
        assert.equal((response.body as any)?.success, true);
        assert.equal((response.body as any)?.data?.modifiedCount, 1);

        const refreshedStatuses = await OwnerApplicationStatus.find({
          _id: {
            $in: [
              scopeApplicationStatus._id,
              scopeInspectionStatus._id,
              scopePaymentStatus._id,
            ],
          },
        })
          .sort({ createdAt: 1 })
          .lean();

        const refreshedById = new Map(
          refreshedStatuses.map((status) => [String(status._id), status]),
        );

        assert.equal(
          refreshedById.get(String(scopeApplicationStatus._id))?.isRead,
          true,
        );
        assert.equal(
          refreshedById.get(String(scopeInspectionStatus._id))?.isRead,
          false,
        );
        assert.equal(
          refreshedById.get(String(scopePaymentStatus._id))?.isRead,
          false,
        );
      },
    );

    await runCase(
      "inactive permit resubmission stays accessible until it is submitted",
      async () => {
        const permitResponse = await ownerResubmitClient.request({
          method: "GET",
          path: `/api/owner/permits/${inactivePermit._id}?applicationId=${resubmitApplication._id}`,
        });

        assert.equal(permitResponse.status, 200);
        assert.equal((permitResponse.body as any)?.success, true);

        const applicationResponse = await ownerResubmitClient.request({
          method: "GET",
          path: `/api/owner/applications/${resubmitApplication._id}`,
        });

        assert.equal(applicationResponse.status, 200);
        assert.equal(
          (applicationResponse.body as any)?.data?.tableStatus,
          "re_submission",
        );

        const resubmitResponse = await ownerResubmitClient.request({
          method: "PUT",
          path: `/api/owner/applications/${resubmitApplication._id}/resubmit`,
          body: {
            responses: createResponses("Updated Resubmission Business"),
          },
        });

        assert.equal(resubmitResponse.status, 200);
        assert.equal((resubmitResponse.body as any)?.success, true);
        assert.equal(
          (resubmitResponse.body as any)?.data?.currentStage,
          "evaluator_application_request",
        );

        const applicationAfterResubmit = await ownerResubmitClient.request({
          method: "GET",
          path: `/api/owner/applications/${resubmitApplication._id}`,
        });

        assert.equal(applicationAfterResubmit.status, 404);

        const inactiveAfterResubmit = await ownerResubmitClient.request({
          method: "GET",
          path: `/api/owner/permits/${inactivePermit._id}?applicationId=${resubmitApplication._id}`,
        });

        assert.equal(inactiveAfterResubmit.status, 409);

        const statusesResponse = await ownerResubmitClient.request({
          method: "GET",
          path: "/api/owner/applications/status",
        });

        assert.equal(statusesResponse.status, 200);
        const statuses = Array.isArray((statusesResponse.body as any)?.data)
          ? ((statusesResponse.body as any).data as any[])
          : [];
        const resubmissionEntry = statuses.find(
          (status) => String(status._id) === String(resubmitStatus._id),
        );

        assert.ok(resubmissionEntry);
        assert.equal(resubmissionEntry.canResubmit, false);
      },
    );

    await runCase(
      "reassessment request updates the application and closes the action",
      async () => {
        const response = await ownerReassessClient.request({
          method: "PATCH",
          path: `/api/owner/applications/${reassessmentApplication._id}/reassessment-request`,
        });

        assert.equal(response.status, 200);
        assert.equal((response.body as any)?.success, true);

        const refreshedApplication = await PermitApplication.findById(
          reassessmentApplication._id,
        )
          .select("inspectionFlow ownerStatusSource")
          .lean();

        const currentStep =
          refreshedApplication?.inspectionFlow?.steps?.[
            Number(refreshedApplication?.inspectionFlow?.currentStepIndex ?? 0)
          ];
        assert.ok(currentStep?.reassessmentRequestedAt);
        assert.equal(currentStep?.scheduleStatus, "unscheduled");
        assert.equal(currentStep?.scheduledInspectionAt, null);
        assert.equal(refreshedApplication?.ownerStatusSource, "inspector");

        const detailResponse = await ownerReassessClient.request({
          method: "GET",
          path: `/api/owner/applications/${reassessmentStatus._id}/status-detail`,
        });

        assert.equal(detailResponse.status, 200);
        assert.equal(
          (detailResponse.body as any)?.data?.canRequestReassessment,
          false,
        );
        assert.ok((detailResponse.body as any)?.data?.reassessmentRequestedAt);
      },
    );

    await runCase(
      "generated document detail stays metadata-only and PDFs remain downloadable",
      async () => {
        const detailResponse = await ownerDocsClient.request({
          method: "GET",
          path: `/api/owner/applications/${generatedDocumentsStatus._id}/status-detail`,
        });

        assert.equal(detailResponse.status, 200);
        const detailData = (detailResponse.body as any)?.data;
        assert.ok(detailData?.generatedPermit);
        assert.ok(detailData?.generatedInspectionCertificate);
        assert.equal(detailData.generatedPermit.file.pdf.available, true);
        assert.equal(
          "watermarkedContentBase64" in
            (detailData.generatedPermit.file.pdf ?? {}),
          false,
        );
        assert.equal(
          "contentBase64" in (detailData.generatedPermit.file ?? {}),
          false,
        );

        const documentsResponse = await ownerDocsClient.request({
          method: "GET",
          path: "/api/owner/generated-documents",
        });

        assert.equal(documentsResponse.status, 200);
        const documents = Array.isArray((documentsResponse.body as any)?.data)
          ? ((documentsResponse.body as any).data as any[])
          : [];
        const permitEntry = documents.find(
          (document) =>
            document.statusId === String(generatedDocumentsStatus._id) &&
            document.documentKind === "permit",
        );
        const inspectionEntry = documents.find(
          (document) =>
            document.statusId === String(generatedDocumentsStatus._id) &&
            document.documentKind === "inspection_certificate",
        );

        assert.ok(permitEntry);
        assert.ok(inspectionEntry);

        const permitPdfResponse = await ownerDocsClient.request({
          method: "GET",
          path: `/api/owner/applications/${generatedDocumentsStatus._id}/generated-permit`,
          expectBinary: true,
        });

        assert.equal(permitPdfResponse.status, 200);
        assert.match(
          String(permitPdfResponse.headers.get("content-type") ?? ""),
          /application\/pdf/i,
        );
        assert.deepEqual(
          permitPdfResponse.buffer,
          generatedPermit.watermarkedBuffer,
        );

        const inspectionPdfResponse = await ownerDocsClient.request({
          method: "GET",
          path: `/api/owner/applications/${generatedDocumentsStatus._id}/generated-inspection-certificate`,
          expectBinary: true,
        });

        assert.equal(inspectionPdfResponse.status, 200);
        assert.match(
          String(inspectionPdfResponse.headers.get("content-type") ?? ""),
          /application\/pdf/i,
        );
        assert.deepEqual(
          inspectionPdfResponse.buffer,
          generatedInspectionCertificate.watermarkedBuffer,
        );
      },
    );

    console.log("All owner regression checks passed.");
  } finally {
    try {
      const Account = (await import("../models/account/account.model")).default;
      const Permit = (await import("../models/permit/permit.model")).default;
      const PermitApplication = (
        await import("../models/permit_application/permit-application.model")
      ).default;
      const OwnerApplicationStatus = (
        await import("../models/owner_application_status/owner-application-status.model")
      ).default;

      await OwnerApplicationStatus.deleteMany({
        permitName: { $in: Object.values(permitNames) },
      }).exec();
      await PermitApplication.deleteMany({
        permitName: { $in: Object.values(permitNames) },
      }).exec();
      await Permit.deleteMany({
        name: { $in: Object.values(permitNames) },
      }).exec();
      await Account.deleteMany({
        email: { $in: Object.values(emails) },
      }).exec();
    } catch (cleanupError) {
      console.error("Cleanup failed:", cleanupError);
    }

    if (server) {
      await closeServer(server);
    }

    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
};

main().catch((error) => {
  process.exitCode = 1;
  console.error(error);
});
