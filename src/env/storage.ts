import { optionalEnv } from "feature-env";

import { envSchema } from "@/env/schema";
import { AppError } from "@/utils/error/app-error.util";

const values = optionalEnv(envSchema, ["storage"] as const);

const read = (value: unknown) => String(value ?? "").trim();

export const getStorageEnv = () => {
  const endpoint = read(values.R2_ENDPOINT).replace(/\/+$/, "");
  const accessKeyId = read(values.R2_ACCESS_KEY_ID);
  const secretAccessKey = read(values.R2_SECRET_ACCESS_KEY);
  const bucket = read(values.R2_BUCKET);

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new AppError(
      "Cloudflare R2 is not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET.",
      503,
    );
  }

  return { endpoint, accessKeyId, secretAccessKey, bucket };
};
