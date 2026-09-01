import { deleteObject, getObject, uploadObject } from "@/services/storage/r2.service";
import { AppError } from "@/utils/error/app-error.util";
import type { Request, Response } from "express";
import { Readable } from "stream";

const uploadLimitBytes = 50 * 1024 * 1024;

export const uploadFile = async (req: Request, res: Response) => {
  const body = req.body;

  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new AppError("Select a file to upload.", 400);
  }

  if (body.length > uploadLimitBytes) {
    throw new AppError("Files must be 50 MB or smaller.", 413);
  }

  const location = await uploadObject({
    folder: req.query.folder,
    filename: req.query.filename,
    body,
    contentType: req.headers["content-type"] || "application/octet-stream",
  });

  const params = new URLSearchParams({
    folder: location.folder,
    filename: location.filename,
  });

  res.status(201).json({
    folder: location.folder,
    filename: location.filename,
    url: `/api/uploads/render?${params.toString()}`,
  });
};

export const renderFile = async (req: Request, res: Response) => {
  const object = await getObject(req.query.folder, req.query.filename);
  const body = object.Body;

  if (!body || !(body instanceof Readable)) {
    throw new AppError("Stored file could not be read.", 500);
  }

  res.setHeader(
    "Content-Type",
    object.ContentType || "application/octet-stream",
  );
  // The React app is served from a different local/deployed origin than the
  // API, so images need an explicit resource-sharing policy.
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Cache-Control", "private, max-age=3600");
  body.on("error", (error) => res.destroy(error));
  body.pipe(res);
};

export const removeFile = async (req: Request, res: Response) => {
  await deleteObject(req.query.folder, req.query.filename);
  res.status(200).json({ message: "File deleted successfully." });
};
