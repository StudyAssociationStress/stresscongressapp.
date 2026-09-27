import { read, utils, type WorkBook } from "@e965/xlsx";

export type ImportRow = {
  name: string;
  email: string;
  role: string;
  event_year?: string;
};

export const SUPPORTED_IMPORT_EXTENSIONS =
  /\.(csv|tsv|txt|xlsx|xls|xlsm|xlsb|ods)$/i;

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function normalizeImportRows(
  rows: Record<string, unknown>[],
): ImportRow[] {
  return rows.map((row) => {
    const normalized = Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        normalizeHeader(key),
        String(value ?? "").trim(),
      ]),
    );
    const getFirst = (...keys: string[]) => {
      for (const key of keys) {
        const value = normalized[normalizeHeader(key)];
        if (value) return value;
      }
      return "";
    };

    return {
      name: getFirst("name", "full_name", "fullname"),
      email: getFirst("email", "email_address", "emailaddress").toLowerCase(),
      role: (getFirst("role") || "attendee").toLowerCase(),
      event_year: getFirst("event_year", "eventyear", "year") || undefined,
    };
  });
}

export function parseImportWorkbook(workbook: WorkBook): ImportRow[] {
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("The file does not contain a worksheet.");

  const sheet = workbook.Sheets[sheetName];
  const rows = utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });
  return normalizeImportRows(rows);
}

export function parseImportArrayBuffer(data: ArrayBuffer): ImportRow[] {
  return parseImportWorkbook(read(data, { type: "array" }));
}

export function parseImportBase64(data: string): ImportRow[] {
  return parseImportWorkbook(read(data, { type: "base64" }));
}
