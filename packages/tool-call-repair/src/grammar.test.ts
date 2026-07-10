import { describe, expect, it } from "vitest";
import { findXmlishToolCallEnd } from "./grammar.js";

describe("findXmlishToolCallEnd", () => {
  it("returns the end of a zero-argument XML function call", () => {
    const raw = "<function=get_system_info></function>";
    expect(findXmlishToolCallEnd(raw)).toBe(raw.length);
  });

  it("returns the end of a zero-argument XML function call with trailing newline", () => {
    const raw = "<function=get_system_info></function>\n";
    expect(findXmlishToolCallEnd(raw)).toBe(raw.length);
  });

  it("still requires parameters for bracketed XML-ish openings", () => {
    expect(findXmlishToolCallEnd("[tool:get_system_info]</function>")).toBeNull();
    expect(findXmlishToolCallEnd("[get_system_info]\n</function>")).toBeNull();
  });

  it("still parses parameter-bearing XML function calls", () => {
    const raw = "<function=get_weather><parameter=city>Tokyo</parameter></function>";
    expect(findXmlishToolCallEnd(raw)).toBe(raw.length);
  });
});
