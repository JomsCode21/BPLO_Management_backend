import assert from "node:assert/strict";
import path from "node:path";

import dotenv from "dotenv";
import mongoose from "mongoose";

import Account from "../models/account/account.model";
import Permit from "../models/permit/permit.model";
import PermitApplication from "../models/permit_application/permit-application.model";
import PermitTemplate from "../models/permit_template/permit-template.model";
import { getPermitValidityApplicationsS } from "../services/bplo-admin/bplo-admin.service";

process.env.NODE_ENV = "test";
dotenv.config({
  path: path.resolve(process.cwd(), ".env"),
});

const setEnvDefault = (key: string, fallback: string) => {
  process.env[key] = process.env[key]?.trim() || fallback;
};

setEnvDefault(
  "MONGO_DB_URI",
  "mongodb://127.0.0.1:27017/bplo_validity_auto_increment_test",
);

const runCase = async (name: string, callback: () => Promise<void>) => {
  try {
    await callback();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
};

const main = async () => {
  const runId = `bplo-validity-${Date.now()}`;
  const permitName = `${runId}-permit`;
  const accountEmail = `${runId}-owner@example.com`;
  const adminEmail = `${runId}-admin@example.com`;

  try {
    const initDB = (await import("../db/db.connect")).default;
    await initDB();
    assert.equal(
      mongoose.connection.readyState,
      1,
      "MongoDB connection is required for this test.",
    );

    await PermitApplication.deleteMany({ permitName }).exec();
    await Permit.deleteMany({ name: permitName }).exec();
    await PermitTemplate.deleteMany({ linkedPermitName: permitName }).exec();
    await Account.deleteMany({ email: { $in: [accountEmail, adminEmail] } }).exec();

    const [owner, admin] = await Account.create([
      {
        firstName: "Validity",
        middleName: "",
        lastName: "Owner",
        suffix: "",
        gender: "Prefer not to say",
        email: accountEmail,
        password: "Owner@123",
        role: "business_owner",
        authProvider: "local",
        isVerified: true,
      },
      {
        firstName: "Validity",
        middleName: "",
        lastName: "Admin",
        suffix: "",
        gender: "Prefer not to say",
        email: adminEmail,
        password: "Admin@123",
        role: "super_admin",
        authProvider: "local",
        isVerified: true,
      },
    ]);

    const permit = await Permit.create({
      name: permitName,
      description: "Validity auto increment test permit",
      formTitle: "Validity Form",
      formDescription: "Test form",
      isActive: true,
      showInPermitValidity: true,
      enablePermitValidityFormDisplay: true,
      permitValidityDisplayFieldIds: ["business_name"],
      sections: [
        {
          id: "main",
          title: "Main",
          layout: "one_column",
        },
      ],
      fields: [
        {
          id: "business_name",
          type: "text",
          label: "Business Name",
          placeholder: "",
          placeholderMode: "manual",
          validation: { kind: "none", regex: "", message: "" },
          required: true,
          options: [],
          sectionId: "main",
        },
      ],
    });

    const templateId = new mongoose.Types.ObjectId();
    await PermitTemplate.create({
      _id: templateId,
      templateScope: "permit",
      name: `${permitName}-template`,
      linkedPermitId: String(permit._id),
      linkedPermitName: permitName,
      fileName: "template.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      contentBase64: Buffer.from("docx-content").toString("base64"),
      status: "active",
      version: 1,
      placeholders: ["permit_number", "business_name"],
      mappings: [
        {
          placeholder: "permit_number",
          label: "Permit Number",
          sourceType: "auto_increment",
          sourceKey: "auto_increment",
          fixedValue: "",
          autoIncrement: {
            prefix: "BPLO-",
            suffix: "",
            paddingLength: 4,
            resetRule: "yearly",
          },
          confidence: "high",
          needsReview: false,
        },
        {
          placeholder: "business_name",
          label: "Business Name",
          sourceType: "field",
          sourceKey: "field.business_name",
          fixedValue: "",
          autoIncrement: null,
          confidence: "high",
          needsReview: false,
        },
      ],
      autoIncrementStates: [],
      createdBy: admin._id,
      updatedBy: admin._id,
    });

    const now = new Date();
    await PermitApplication.create({
      permit: permit._id,
      applicant: owner._id,
      permitName,
      formTitle: "Validity Form",
      responses: [
        {
          fieldId: "business_name",
          label: "Business Name",
          type: "text",
          value: "Acme Foods",
        },
      ],
      status: "approved",
      tableStatus: "for_review",
      currentStage: "admin_permit_validity",
      destinationModule: "admin_permit_validity",
      adminResult: {
        admin: admin._id,
        decision: "approved",
        remark: "",
        decidedAt: now,
      },
      paymentAssessments: [
        {
          departmentId: "bplo_admin_assessment",
          departmentName: "BPLO Admin",
          generatedAt: now,
          items: [{ feeName: "Permit Fee", amount: 500 }],
          totalAmount: 500,
          paymentStatus: "paid",
          statusUpdatedBy: admin._id,
          statusUpdatedByName: "Validity Admin",
          statusUpdatedAt: now,
        },
      ],
      generatedPermit: {
        templateId: String(templateId),
        templateName: `${permitName}-template`,
        templateVersion: 1,
        placeholders: ["permit_number", "business_name"],
        resolvedValues: {
          permit_number: "BPLO-0001",
          business_name: "Acme Foods",
        },
        generatedPreview: "Permit preview",
        status: "generated",
        generatedBy: admin._id,
        confirmedBy: null,
        confirmedAt: null,
        sentToApplicantBy: null,
        sentToApplicantAt: null,
        file: {
          fileName: "permit.docx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          contentBase64: Buffer.from("permit-content").toString("base64"),
          generatedAt: now,
          watermarkText: "BPLO",
          watermarkFontSizePt: 48,
          pdf: null,
          pageSizeMm: null,
        },
      },
      submittedAt: now,
    });

    await runCase(
      "includes generated permit auto-increment value in permit validity displayed fields",
      async () => {
        const rows = await getPermitValidityApplicationsS();
        const target = rows.find((row) => row.permitType === permitName);

        assert.ok(target, "Expected permit validity row to exist.");
        assert.ok(Array.isArray(target?.displayedFields));

        const autoIncrementField = target?.displayedFields?.find(
          (field) => field.fieldId === "auto_increment:permit_number",
        );

        assert.ok(
          autoIncrementField,
          "Expected auto-increment field to be included in displayedFields.",
        );
        assert.equal(autoIncrementField?.label, "Permit Number");
        assert.equal(autoIncrementField?.value, "BPLO-0001");
      },
    );

    console.log("All BPLO permit validity auto-increment tests passed.");
  } finally {
    try {
      await PermitApplication.deleteMany({ permitName }).exec();
      await Permit.deleteMany({ name: permitName }).exec();
      await PermitTemplate.deleteMany({ linkedPermitName: permitName }).exec();
      await Account.deleteMany({
        email: { $in: [accountEmail, adminEmail] },
      }).exec();
    } catch (cleanupError) {
      console.error("Cleanup failed:", cleanupError);
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
