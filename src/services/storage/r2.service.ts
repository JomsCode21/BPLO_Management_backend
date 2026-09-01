import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getStorageEnv } from "@/env/storage";
import { AppError } from "@/utils/error/app-error.util";

let client: S3Client | null = null;

const getClient = () => {
  if (client) return client;

  const env = getStorageEnv();
  client = new S3Client({
    region: "auto",
    endpoint: env.endpoint,
    credentials: {
      accessKeyId: env.accessKeyId,
      secretAccessKey: env.secretAccessKey,
    },
  });

  return client;
};

const normalizeFolder = (folder: unknown) => {
  const value = String(folder ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");

  if (!value || !/^[a-zA-Z0-9_./-]+$/.test(value) || value.includes("..")) {
    throw new AppError("Invalid upload folder.", 400);
  }

  return value;
};

const normalizeFilename = (filename: unknown) => {
  const value = String(filename ?? "").trim();

  if (
    !value ||
    value.length > 180 ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("..")
  ) {
    throw new AppError("Invalid file name.", 400);
  }

  return value;
};

export const getObjectLocation = (folder: unknown, filename: unknown) => {
  const normalizedFolder = normalizeFolder(folder);
  const normalizedFilename = normalizeFilename(filename);

  return {
    folder: normalizedFolder,
    filename: normalizedFilename,
    key: `${normalizedFolder}/${normalizedFilename}`,
  };
};

export const uploadObject = async (params: {
  folder: unknown;
  filename: unknown;
  body: Buffer;
  contentType: string;
}) => {
  const location = getObjectLocation(params.folder, params.filename);
  const { bucket } = getStorageEnv();

  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: location.key,
      Body: params.body,
      ContentType: params.contentType,
    }),
  );

  return location;
};

export const getObject = async (folder: unknown, filename: unknown) => {
  const location = getObjectLocation(folder, filename);
  const { bucket } = getStorageEnv();

  return getClient().send(
    new GetObjectCommand({ Bucket: bucket, Key: location.key }),
  );
};

export const deleteObject = async (folder: unknown, filename: unknown) => {
  const location = getObjectLocation(folder, filename);
  const { bucket } = getStorageEnv();

  await getClient().send(
    new DeleteObjectCommand({ Bucket: bucket, Key: location.key }),
  );
};
