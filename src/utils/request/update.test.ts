import { describe, expect, it, vi } from "vitest";

// utils/common 依赖浏览器环境，这里只需要 compareVersions
vi.mock("../common", () => ({
  compareVersions: (a: string, b: string) => {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  },
}));
import { parseUpdateInfo, RELEASES_PAGE } from "./update";

describe("parseUpdateInfo", () => {
  it("detects a newer release", () => {
    expect(
      parseUpdateInfo(
        {
          tag_name: "v1.0.3",
          html_url: "https://github.com/sure0000/mentor/releases/tag/v1.0.3",
        },
        "1.0.2"
      )
    ).toEqual({
      hasUpdate: true,
      latestVersion: "1.0.3",
      url: "https://github.com/sure0000/mentor/releases/tag/v1.0.3",
    });
  });

  it("reports no update for same or older release", () => {
    expect(parseUpdateInfo({ tag_name: "v1.0.2" }, "1.0.2")?.hasUpdate).toBe(
      false
    );
    expect(parseUpdateInfo({ tag_name: "1.0.1" }, "1.0.2")?.hasUpdate).toBe(
      false
    );
  });

  it("falls back to releases page for untrusted urls", () => {
    expect(
      parseUpdateInfo(
        { tag_name: "v2.0.0", html_url: "https://evil.example.com" },
        "1.0.2"
      )?.url
    ).toBe(RELEASES_PAGE);
  });

  it("rejects malformed tags", () => {
    expect(parseUpdateInfo({ tag_name: "nightly" }, "1.0.2")).toBeNull();
    expect(parseUpdateInfo({}, "1.0.2")).toBeNull();
  });
});
