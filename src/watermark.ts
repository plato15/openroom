import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";

/** Standard PDF fonts only cover Latin-1; keep the stamp to plain ASCII. */
const ascii = (s: string) => s.replace(/[^\x20-\x7e]/g, "?");

/**
 * Stamps every page with who it was shared with and when, so a forwarded copy can be traced.
 * Throws if the PDF cannot be read (for example, password protected); callers fail closed.
 */
export async function watermarkPdf(bytes: ArrayBuffer, email: string, when: Date, host = ""): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const date = when.toISOString().slice(0, 10);
  const diagonal = ascii(`${email}  ${date}`);
  const footer = ascii(`Confidential. Shared with ${email} on ${date}${host ? ` via ${host}` : ""}. Do not forward.`);

  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.max(14, Math.min(width, height) / 22);
    const textWidth = font.widthOfTextAtSize(diagonal, size);
    const angle = Math.atan2(height, width);
    page.drawText(diagonal, {
      x: width / 2 - (Math.cos(angle) * textWidth) / 2,
      y: height / 2 - (Math.sin(angle) * textWidth) / 2,
      size,
      font,
      color: rgb(0.45, 0.5, 0.6),
      opacity: 0.16,
      rotate: degrees((angle * 180) / Math.PI),
    });
    const footSize = Math.max(6, Math.min(8, width / 80));
    page.drawText(footer, {
      x: 18,
      y: 10,
      size: footSize,
      font,
      color: rgb(0.4, 0.45, 0.55),
      opacity: 0.8,
      maxWidth: width - 36,
    });
  }
  pdf.setSubject(ascii(`Shared with ${email} on ${date}`));
  return pdf.save({ useObjectStreams: false });
}

/** True if we can open and stamp this PDF. Used at upload so problems show up for the admin, not the investor. */
export async function canWatermark(bytes: ArrayBuffer): Promise<boolean> {
  try {
    await PDFDocument.load(bytes, { updateMetadata: false });
    return true;
  } catch {
    return false;
  }
}

export async function orientationOf(bytes: ArrayBuffer): Promise<"portrait" | "landscape"> {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  const first = pdf.getPages()[0];
  if (!first) return "portrait";
  const { width, height } = first.getSize();
  const turned = (first.getRotation().angle / 90) % 2 !== 0;
  return (turned ? height > width : width > height) ? "landscape" : "portrait";
}
