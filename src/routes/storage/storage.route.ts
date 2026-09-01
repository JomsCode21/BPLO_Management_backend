import * as StorageController from "@/controllers/storage/storage.controller";
import { requireAccessToken } from "@/middlewares/token.middleware";
import { raw, Router } from "express";

export const storageRouter = Router();

// Files must remain displayable in browser images and links, which cannot add
// the SPA's Authorization header. Upload and deletion stay authenticated.
storageRouter.get("/render", StorageController.renderFile);
storageRouter.post(
  "/",
  requireAccessToken,
  raw({ type: "*/*", limit: "50mb" }),
  StorageController.uploadFile,
);
storageRouter.delete("/", requireAccessToken, StorageController.removeFile);
