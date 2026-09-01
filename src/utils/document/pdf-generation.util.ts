import { execFile } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { PDFDocument, degrees, rgb } from "pdf-lib";

export const PDF_MIME_TYPE = "application/pdf";

// Escapes values for safe interpolation inside single-quoted PowerShell strings.
const escapePowerShellSingleQuoted = (value: string) =>
  value.replace(/'/g, "''");

// Executes a PowerShell command and surfaces conversion-specific errors.
const runPowerShell = async (script: string) => {
  await new Promise<void>((resolve, reject) => {
    execFile(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
      ],
      { windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error) {
          const details = String(stderr ?? "").trim();
          reject(
            new Error(
              details
                ? `MS Word conversion failed: ${details}`
                : `MS Word conversion failed: ${error.message}`,
            ),
          );
          return;
        }
        resolve();
      },
    );
  });
};

// Converts a DOCX buffer to a PDF buffer using MS Word COM automation.
export const convertDocxBufferToPdfBuffer = async (docxBuffer: Buffer) => {
  if (!Buffer.isBuffer(docxBuffer) || docxBuffer.length === 0) {
    throw new Error("DOCX buffer is empty.");
  }

  if (process.platform !== "win32") {
    throw new Error(
      "MS Office DOCX-to-PDF conversion is only supported on Windows servers.",
    );
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bplo-word-pdf-"));
  const sourcePath = path.join(tempDir, "source.docx");
  const outputPath = path.join(tempDir, "source.pdf");

  try {
    await fs.writeFile(sourcePath, docxBuffer);

    const sourcePs = escapePowerShellSingleQuoted(sourcePath);
    const outputPs = escapePowerShellSingleQuoted(outputPath);
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$sourcePath = '${sourcePs}'`,
      `$outputPath = '${outputPs}'`,
      "$word = $null",
      "$doc = $null",
      "try {",
      "  $word = New-Object -ComObject Word.Application",
      "  $word.Visible = $false",
      "  $word.DisplayAlerts = 0",
      "  $doc = $word.Documents.Open($sourcePath, $false, $true)",
      "  try {",
      "    $doc.SaveAs2($outputPath, 17)",
      "  } catch {",
      "    $wdFormatPDF = 17",
      "    $doc.SaveAs([ref]$outputPath, [ref]$wdFormatPDF)",
      "  }",
      "} finally {",
      "  if ($doc -ne $null) { $doc.Close([ref]$false) }",
      "  if ($word -ne $null) { $word.Quit() }",
      "  [System.GC]::Collect()",
      "  [System.GC]::WaitForPendingFinalizers()",
      "}",
    ].join("; ");

    await runPowerShell(script);
    const pdfBuffer = await fs.readFile(outputPath);

    if (!pdfBuffer || pdfBuffer.length === 0) {
      throw new Error("MS Word conversion returned empty PDF output.");
    }

    return pdfBuffer;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown MS Word conversion error";
    throw new Error(message);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
};

// Applies diagonal watermark text to each page of a clear PDF buffer.
export const buildWatermarkedPdfFromClearPdf = async (params: {
  clearPdfBuffer: Buffer;
  watermarkText: string;
  watermarkFontSizePt?: number;
}) => {
  if (
    !Buffer.isBuffer(params.clearPdfBuffer) ||
    params.clearPdfBuffer.length === 0
  ) {
    throw new Error("Clear PDF buffer is empty.");
  }

  const watermark = String(params.watermarkText ?? "").trim();
  if (!watermark) {
    return params.clearPdfBuffer;
  }
  const requestedFontSize = Number(params.watermarkFontSizePt ?? 0);

  const document = await PDFDocument.load(params.clearPdfBuffer);
  const pages = document.getPages();

  for (const page of pages) {
    const { width, height } = page.getSize();
    const adaptiveFontSize = Math.max(Math.min(width, height) / 14, 18);
    const fontSize =
      Number.isFinite(requestedFontSize) && requestedFontSize >= 12
        ? Math.min(requestedFontSize, 200)
        : adaptiveFontSize;
    const textWidth = watermark.length * fontSize * 0.45;
    const x = Math.max((width - textWidth) / 2, 12);
    const y = Math.max(height / 2, 12);

    page.drawText(watermark, {
      x,
      y,
      size: fontSize,
      rotate: degrees(32),
      color: rgb(0.64, 0.67, 0.71),
      opacity: 0.2,
    });
  }

  const bytes = await document.save();
  return Buffer.from(bytes);
};
