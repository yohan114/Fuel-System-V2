import { describe, expect, it } from "vitest";
import { agingBucketFor } from "../src/lib/billing/aging";

describe("agingBucketFor", () => {
  it("keeps not-yet-due invoices in current", () => {
    expect(agingBucketFor(-10)).toBe("current");
    expect(agingBucketFor(0)).toBe("current");
  });
  it("buckets by days past due with inclusive boundaries", () => {
    expect(agingBucketFor(1)).toBe("d1_30");
    expect(agingBucketFor(30)).toBe("d1_30");
    expect(agingBucketFor(31)).toBe("d31_60");
    expect(agingBucketFor(60)).toBe("d31_60");
    expect(agingBucketFor(61)).toBe("d60plus");
    expect(agingBucketFor(365)).toBe("d60plus");
  });
});
