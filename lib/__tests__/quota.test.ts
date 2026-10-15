import { describe, expect, it } from "vitest";
import { quotaLevel, toStorageQuota } from "../quota";

const GB = 1024 ** 3;

describe("toStorageQuota", () => {
  it("uses hardLimit when there is no softLimit", () => {
    expect(toStorageQuota([{ resourceType: "octets", used: 1, hardLimit: GB }])).toEqual({ used: 1, total: GB });
  });

  it("treats a softLimit below hardLimit as 100% and keeps hardLimit aside (#1242)", () => {
    const quota = toStorageQuota([{ resourceType: "octets", used: GB, hardLimit: 1.1 * GB, softLimit: GB }]);
    expect(quota).toEqual({ used: GB, total: GB, hardLimit: 1.1 * GB });
    expect(quotaLevel(quota!)).toBe("full");
  });

  it("ignores a softLimit that is null, zero or not below hardLimit", () => {
    for (const softLimit of [null, 0, GB, 2 * GB]) {
      expect(toStorageQuota([{ resourceType: "octets", used: 0, hardLimit: GB, softLimit }])).toEqual({ used: 0, total: GB });
    }
  });

  it("falls back to the pre-RFC limit field", () => {
    expect(toStorageQuota([{ scope: "mail", used: 5, limit: 10 }])).toEqual({ used: 5, total: 10 });
  });

  it("keeps warnLimit only when it is below the effective limit", () => {
    expect(toStorageQuota([{ resourceType: "octets", used: 0, hardLimit: 100, softLimit: 80, warnLimit: 50 }])?.warnAt).toBe(50);
    expect(toStorageQuota([{ resourceType: "octets", used: 0, hardLimit: 100, softLimit: 80, warnLimit: 90 }])?.warnAt).toBeUndefined();
  });

  it("skips quotas that don't cover mail", () => {
    expect(toStorageQuota([{ resourceType: "octets", types: ["FileNode"], used: 1, hardLimit: 2 }])).toBeNull();
  });
});

describe("quotaLevel", () => {
  it("warns from warnLimit when the server sets one", () => {
    expect(quotaLevel({ used: 40, total: 100, warnAt: 40 })).toBe("warn");
    expect(quotaLevel({ used: 39, total: 100, warnAt: 40 })).toBe("ok");
  });

  it("warns above 70% without a warnLimit and is full above 90%", () => {
    expect(quotaLevel({ used: 70, total: 100 })).toBe("ok");
    expect(quotaLevel({ used: 71, total: 100 })).toBe("warn");
    expect(quotaLevel({ used: 91, total: 100, warnAt: 95 })).toBe("full");
  });
});
