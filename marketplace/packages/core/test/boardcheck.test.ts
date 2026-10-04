import { describe, expect, it } from "vitest";
import { classifyBoardStatus, parseBoardFile } from "../src";

describe("state license status", () => {
  it.each([
    ["Clear/Active", "ACTIVE"],
    ["ACTIVE", "ACTIVE"],
    ["Clear/Inactive", "INACTIVE"],
    ["Delinquent", "INACTIVE"],
    ["Null and Void", "INACTIVE"],
    ["Emergency Suspension", "INACTIVE"],
    ["Revoked", "INACTIVE"],
    ["Retired", "INACTIVE"],
    ["Probation/Active", "REVIEW"],
    ["Obligations/Active", "REVIEW"],
    ["Something new", "REVIEW"],
  ])("%s → %s", (s, v) => expect(classifyBoardStatus(s)).toBe(v));
});

describe("state license file", () => {
  it("with a header: finds our numbers, the status and the discipline flag", () => {
    const text = [
      "BOARD|PROFESSION|LICENSE_NUMBER|LAST_NAME|LICENSE_STATUS_DESCRIPTION|EXPIRATION_DATE|DISCIPLINE_ON_FILE",
      "1501|Chiropractic Physician|CH 12345|Smith|Clear/Active|03/31/2027|N",
      "1501|Chiropractic Physician|CH 22222|Jones|Delinquent|03/31/2025|N",
      "1501|Chiropractic Physician|CH 33333|Brown|Probation/Active|03/31/2027|Y",
      "1501|Chiropractic Physician|CH 99999|Other|Clear/Active|03/31/2027|N",
    ].join("\n");
    const r = parseBoardFile(text, ["CH12345", "ch-22222", "33333", "CH44444"]);
    expect(r.get("CH12345")).toEqual({ status: "Clear/Active", discipline: false, expires: "03/31/2027" });
    expect(r.get("ch-22222")?.status).toBe("Delinquent");
    expect(r.get("33333")).toMatchObject({ status: "Probation/Active", discipline: true });
    expect(r.has("CH44444")).toBe(false);
    expect(r.size).toBe(3);
  });

  it("without a header: matches the number in any field and reads the status word", () => {
    const text = "Smith|John|CH12345|Clear/Active|ORLANDO|FL\nDoe|Jane|CH55555|Null and Void|MIAMI|FL\n";
    const r = parseBoardFile(text, ["CH12345", "CH55555"]);
    expect(r.get("CH12345")).toEqual({ status: "Clear/Active", discipline: null, expires: null });
    expect(r.get("CH55555")?.status).toBe("Null and Void");
  });
});
