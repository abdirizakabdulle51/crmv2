import { describe, expect, it, vi } from "vitest";
import { downloadCsv, rowsToCsv } from "./csv";

describe("csv helpers", () => {
  it("escapes CSV values and protects spreadsheet formulas", () => {
    const csv = rowsToCsv(
      [
        { header: "Name", value: (row: { name: string }) => row.name },
        { header: "Note", value: (row: { note: string }) => row.note },
      ],
      [
        { name: "Normal", note: "hello" },
        { name: "Comma, Name", note: 'quoted "value"' },
        { name: "=SUM(A1:A2)", note: "+danger" },
      ],
    );

    expect(csv).toBe(
      'Name,Note\r\nNormal,hello\r\n"Comma, Name","quoted ""value"""\r\n\'=SUM(A1:A2),\'+danger',
    );
  });

  it("downloads CSV files through a browser anchor", () => {
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:csv");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(
      () => undefined,
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );

    downloadCsv("finance.csv", "a,b");

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:csv");

    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    click.mockRestore();
  });
});
