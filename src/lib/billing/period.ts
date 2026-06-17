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
export function resolvePeriod(year: number, month: number): BillingPeriod {
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 1, 0, 0, 0, 0);
  end.setMilliseconds(end.getMilliseconds() - 1);
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
