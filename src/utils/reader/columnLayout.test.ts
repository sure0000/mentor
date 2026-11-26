import { describe, expect, test } from "vitest";
import {
  WEREAD_MAX_COLUMN_WIDTH,
  WEREAD_MIN_SIDE_GUTTER,
  getColumnWidth,
} from "./columnLayout";

describe("微信读书式正文栏宽度", () => {
  test("宽屏下正文栏有上限，两侧留白随屏幕变宽而增大", () => {
    const wide = getColumnWidth(1920, 1920 - 106, 1);
    const wider = getColumnWidth(2560, 2560 - 106, 1);
    expect(wide).toBe(WEREAD_MAX_COLUMN_WIDTH);
    expect(wider).toBe(WEREAD_MAX_COLUMN_WIDTH);
    expect((1920 - wide) / 2).toBeGreaterThan(200);
  });

  test("窗口缩小时正文栏变窄、两侧留白减少", () => {
    const gutters = [1400, 1200, 1000, 800].map((width) => {
      const column = getColumnWidth(width, width - 106, 1);
      return { width, column, gutter: (width - column) / 2 };
    });
    for (let i = 1; i < gutters.length; i++) {
      expect(gutters[i].column).toBeLessThan(gutters[i - 1].column);
      expect(gutters[i].gutter).toBeLessThan(gutters[i - 1].gutter);
    }
  });

  test("窄屏仍保留最小留白，正文不贴边", () => {
    const width = 520;
    const column = getColumnWidth(width, width - 106, 1);
    expect(column).toBeLessThanOrEqual(width - 106 - WEREAD_MIN_SIDE_GUTTER * 2);
  });

  test("侧边栏占位后按剩余可用宽度收窄", () => {
    const width = 1400;
    const column = getColumnWidth(width, width - 300 - 106, 1);
    expect(column).toBeLessThanOrEqual(width - 300 - 106);
  });

  test("页面宽度比例仍然生效", () => {
    const full = getColumnWidth(1000, 1000 - 106, 1);
    const half = getColumnWidth(1000, 1000 - 106, 0.5);
    expect(half).toBeCloseTo(full / 2, 0);
  });
});
