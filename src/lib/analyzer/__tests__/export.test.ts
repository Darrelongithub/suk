import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadReport } from "../export";
import type { Analysis } from "../types";

const analysis = {
  meta: {
    data_age: "3h 20m",
    spread_convention: "1.2 pips",
    atr_method: "wilder-14",
    similar_swing_selection_rule: "last 5 similar swings by range",
  },
  spread: 0.00012,
  totalRows: 1,
  analyzedRows: 1,
  invalidRows: 0,
  lastRowDatetime: "2024-05-03 11:30",
  perStrategy: [],
  overlaps: [],
  passing: [],
  live: [],
  historical: [],
  results: [],
  invalidRowList: [],

} as unknown as Analysis;

function stubDom(iframe: boolean) {
  const link: Record<string, unknown> = { click: vi.fn(), remove: vi.fn() };
  const openSpy = vi.fn(() => (iframe ? {} : null));
  vi.stubGlobal("document", {
    createElement: () => link,
    body: { appendChild: vi.fn() },
  });
  vi.stubGlobal("Blob", class {});
  vi.stubGlobal("URL", { createObjectURL: () => "blob:report", revokeObjectURL: vi.fn() });
  const win = { self: {}, top: {}, open: openSpy, setTimeout: vi.fn() };
  if (iframe) win.top = { other: true };
  else win.top = win.self;
  vi.stubGlobal("window", win);
  return { link, openSpy };
}

afterEach(() => vi.unstubAllGlobals());

describe("downloadReport", () => {
  it("auto-downloads with the datetime-derived filename at top level", () => {
    const { link, openSpy } = stubDom(false);
    const outcome = downloadReport(analysis);
    expect(outcome).toMatchObject({
      fileName: "structure-scout_LIVE_2024-05-03-11-30.txt",
      autoDownloaded: true,
    });
    expect(link["download"]).toBe("structure-scout_LIVE_2024-05-03-11-30.txt");
    expect(link["click"]).toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("falls back to a new tab when embedded in an iframe", () => {
    const { openSpy } = stubDom(true);
    const outcome = downloadReport(analysis);
    expect(openSpy).toHaveBeenCalledWith("blob:report", "_blank", "noopener");
    expect(outcome?.url).toBe("blob:report");
  });
});
