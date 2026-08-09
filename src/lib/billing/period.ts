// Colombo-month period math. All billing date boundaries are computed in the
// Asia/Colombo local calendar (mirrors the idiom in src/app/actions/condition.ts)
// so a bill captures the correct month's first/last day regardless of server TZ.

export interface BillingPeriod {
  year: number;
  month: number; // 1-12
  periodKey: string; // "YYYY-MM"
  start: Date; // first instant of the month
  end: Date; // last instant of the month (start of next month minus 1ms)
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Builds a period for an explicit year + 1-based month.
//
// The boundaries are Colombo instants, not the server's. This used to build them
// from local date parts, which is the same thing only on a Colombo-time host. On
// a UTC server the whole billing month slid by a day: fuel is stored at Colombo
// midnight (18:30Z the day before), so the 1st of the month fell BEFORE
// period.start and was billed to nobody, while the 1st of the NEXT month fell
// inside period.end and was billed to the month just closed. Every bill covered
// the wrong 31 days — and the callers below were already careful to resolve the
// Colombo year and month before calling in here, so the intent was always this.
export function resolvePeriod(year: number, month: number): BillingPeriod {
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const start = new Date(`${year}-${pad2(month)}-01T00:00:00+05:30`);
  const end = new Date(new Date(`${nextYear}-${pad2(nextMonth)}-01T00:00:00+05:30`).getTime() - 1);
  return {
    year,
    month,
    periodKey: `${year}-${pad2(month)}`,
    start,
    end,
  };
}

// The month immediately before "now" (Colombo). Run on the 1st, this is the
// month the cron should bill.
export function previousMonthPeriod(now: Date = new Date()): BillingPeriod {
  const todayStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
  const [y, m] = todayStr.split("-").map(Number);
  // Step back one month from the Colombo "today".
  let year = y;
  let month = m - 1;
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  return resolvePeriod(year, month);
}

// The Colombo current month (used as the UI default).
export function currentMonthPeriod(now: Date = new Date()): BillingPeriod {
  const todayStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
  const [y, m] = todayStr.split("-").map(Number);
  return resolvePeriod(y, m);
}
