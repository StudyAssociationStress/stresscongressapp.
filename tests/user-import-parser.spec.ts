import { test, expect } from "@playwright/test";
import {
  utils,
  write,
  type BookType,
  type WorkBook,
  type WorkSheet,
} from "@e965/xlsx";
import {
  parseImportArrayBuffer,
  SUPPORTED_IMPORT_EXTENSIONS,
} from "../client/lib/user-import";

const expectedRows = [
  {
    name: "Jane Example",
    email: "jane@example.com",
    role: "attendee",
    event_year: "2100",
  },
  {
    name: "Staff Example",
    email: "staff@example.com",
    role: "staff",
    event_year: undefined,
  },
];

function workbook(): WorkBook {
  return utils.book_new();
}

function worksheet(): WorkSheet {
  return utils.json_to_sheet([
    {
      "Full Name": "Jane Example",
      "Email Address": "JANE@EXAMPLE.COM",
      Role: "ATTENDEE",
      "Event Year": 2100,
    },
    {
      "Full Name": "Staff Example",
      "Email Address": "staff@example.com",
      Role: "staff",
      "Event Year": "",
    },
  ]);
}

function writeArray(bookType: BookType): ArrayBuffer {
  const book = workbook();
  utils.book_append_sheet(book, worksheet(), "Attendees");
  return write(book, { type: "array", bookType }) as ArrayBuffer;
}

test.describe("attendee import file parser", () => {
  for (const format of ["xlsx", "xlsm", "xlsb", "ods"] as const) {
    test(`parses ${format.toUpperCase()} workbooks`, () => {
      expect(parseImportArrayBuffer(writeArray(format))).toEqual(expectedRows);
    });
  }

  test("parses legacy XLS workbooks", () => {
    expect(parseImportArrayBuffer(writeArray("biff8"))).toEqual(expectedRows);
  });

  for (const delimiter of [
    { label: "CSV", value: "," },
    { label: "TSV", value: "\t" },
  ]) {
    test(`parses ${delimiter.label} text`, () => {
      const text = [
        ["Full Name", "Email Address", "Role", "Event Year"].join(
          delimiter.value,
        ),
        ["Jane Example", "JANE@EXAMPLE.COM", "ATTENDEE", "2100"].join(
          delimiter.value,
        ),
        ["Staff Example", "staff@example.com", "staff", ""].join(
          delimiter.value,
        ),
      ].join("\n");
      const data = new TextEncoder().encode(text).buffer;
      expect(parseImportArrayBuffer(data)).toEqual(expectedRows);
    });
  }

  test("recognizes every supported upload extension", () => {
    for (const extension of [
      "csv",
      "tsv",
      "txt",
      "xls",
      "xlsx",
      "xlsm",
      "xlsb",
      "ods",
    ]) {
      expect(SUPPORTED_IMPORT_EXTENSIONS.test(`attendees.${extension}`)).toBe(
        true,
      );
    }
    expect(SUPPORTED_IMPORT_EXTENSIONS.test("attendees.pdf")).toBe(false);
  });
});
