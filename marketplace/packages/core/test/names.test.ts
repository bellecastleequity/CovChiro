import { describe, expect, it } from "vitest";
import { greetingName } from "../src/names";

describe("greeting name", () => {
  it("Dr. First for doctoral professions, first name otherwise", () => {
    expect(greetingName("Michael Smith", ["DC"])).toBe("Dr. Michael");
    expect(greetingName("Dr. Jane Rivera", ["DC", "LMT"])).toBe("Dr. Jane");
    expect(greetingName("Sam Lee", ["LMT"])).toBe("Sam");
    expect(greetingName("dr. sam lee", ["PT"])).toBe("sam");
    expect(greetingName("", ["DC"])).toBe("");
  });
});
