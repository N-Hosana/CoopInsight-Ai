import multer from "multer";
import path from "path";
import fs from "fs";
import { Request } from "express";

export const UPLOAD_ROOT = path.join(__dirname, "..", "..", "uploads");

function storageFor(subdir: string) {
  const dir = path.join(UPLOAD_ROOT, subdir);
  fs.mkdirSync(dir, { recursive: true });
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (_req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
      cb(null, unique);
    },
  });
}

export const uploadDocument = multer({
  storage: storageFor("documents"),
  limits: { fileSize: 10 * 1024 * 1024 },
});

export const uploadAttachment = multer({
  storage: storageFor("attachments"),
  limits: { fileSize: 10 * 1024 * 1024 },
});

export const uploadPhoto = multer({
  storage: storageFor("photos"),
  limits: { fileSize: 2 * 1024 * 1024 },
});

export function buildFileUrl(req: Request, subdir: string, filename: string): string {
  return `${req.protocol}://${req.get("host")}/uploads/${subdir}/${filename}`;
}
