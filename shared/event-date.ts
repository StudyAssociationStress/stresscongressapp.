const MONTH_NAME_TO_NUMBER: Map<string, number> = new Map([
  ["january", 1],
  ["jan", 1],
  ["february", 2],
  ["feb", 2],
  ["march", 3],
  ["mar", 3],
  ["april", 4],
  ["apr", 4],
  ["may", 5],
  ["june", 6],
  ["jun", 6],
  ["july", 7],
  ["jul", 7],
  ["august", 8],
  ["aug", 8],
  ["september", 9],
  ["sep", 9],
  ["sept", 9],
  ["october", 10],
  ["oct", 10],
  ["november", 11],
  ["nov", 11],
  ["december", 12],
  ["dec", 12],
] as const);

export const EVENT_START_DATE_ERROR_MESSAGE =
  "Start Date is not recognized. Use a format such as 9/9, September 9, or 2027-09-09.";

function normalizeEventYear(year: number): number | null {
  if (!Number.isInteger(year)) return null;
  if (year >= 0 && year < 100) return 2000 + year;
  if (year >= 1000 && year <= 9999) return year;
  return null;
}

function createEventCalendarDate(
  year: number | null,
  month: number,
  day: number,
): Date | null {
  if (
    year === null ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export function parseEventDate(
  value: Date | string | null | undefined,
  defaultYear?: number | null,
): Date | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return createEventCalendarDate(
      value.getFullYear(),
      value.getMonth() + 1,
      value.getDate(),
    );
  }

  const input = value?.trim();
  if (!input) return null;

  const fallbackYear = normalizeEventYear(defaultYear ?? NaN);
  const normalized = input.replace(/,/g, " ").replace(/\s+/g, " ").trim();

  const isoMatch = normalized.match(
    /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/,
  );
  if (isoMatch) {
    return createEventCalendarDate(
      normalizeEventYear(Number(isoMatch[1])),
      Number(isoMatch[2]),
      Number(isoMatch[3]),
    );
  }

  const numericMatch = normalized.match(
    /^(\d{1,2})[/. -](\d{1,2})(?:[/. -](\d{2,4}))?$/,
  );
  if (numericMatch) {
    const first = Number(numericMatch[1]);
    const second = Number(numericMatch[2]);
    const parsedYear = numericMatch[3]
      ? normalizeEventYear(Number(numericMatch[3]))
      : fallbackYear;
    const month = first > 12 && second <= 12 ? second : first;
    const day = first > 12 && second <= 12 ? first : second;
    return createEventCalendarDate(parsedYear, month, day);
  }

  const monthNameFirstMatch = normalized.match(
    /^([a-z]+)[/. -](\d{1,2})(?:[/. -](\d{2,4}))?$/i,
  );
  if (monthNameFirstMatch) {
    const month = MONTH_NAME_TO_NUMBER.get(
      monthNameFirstMatch[1].toLowerCase(),
    );
    const parsedYear = monthNameFirstMatch[3]
      ? normalizeEventYear(Number(monthNameFirstMatch[3]))
      : fallbackYear;
    return month
      ? createEventCalendarDate(
          parsedYear,
          month,
          Number(monthNameFirstMatch[2]),
        )
      : null;
  }

  const dayFirstMonthNameMatch = normalized.match(
    /^(\d{1,2})[/. -]([a-z]+)(?:[/. -](\d{2,4}))?$/i,
  );
  if (dayFirstMonthNameMatch) {
    const month = MONTH_NAME_TO_NUMBER.get(
      dayFirstMonthNameMatch[2].toLowerCase(),
    );
    const parsedYear = dayFirstMonthNameMatch[3]
      ? normalizeEventYear(Number(dayFirstMonthNameMatch[3]))
      : fallbackYear;
    return month
      ? createEventCalendarDate(
          parsedYear,
          month,
          Number(dayFirstMonthNameMatch[1]),
        )
      : null;
  }

  return null;
}
