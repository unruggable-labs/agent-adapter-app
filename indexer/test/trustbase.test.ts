import { describe, expect, it } from "vitest";
import { demoPunksArtifact, mockRegistryArtifact } from "../src/abi.js";
import { analyzeBytecode, verdictOf } from "../src/trustbase.js";

describe("trust-base bytecode heuristics", () => {
  it("detects DemoPunks' open burn function", () => {
    const t = analyzeBytecode(demoPunksArtifact.deployedBytecode);
    expect(t.isEoa).toBe(false);
    expect(t.canBurn).toBe(true);
    expect(t.arbitraryCallSurface).toBe(false);
  });

  it("finds no burn on the burn-free mock registry", () => {
    const t = analyzeBytecode(mockRegistryArtifact.deployedBytecode);
    expect(t.canBurn).toBe(false);
  });

  it("classifies empty code as an EOA and 0xef0100 as a 7702 delegation", () => {
    expect(analyzeBytecode("0x")).toMatchObject({ isEoa: true, delegated7702: false });
    expect(analyzeBytecode("0xef01001111111111111111111111111111111111111111")).toMatchObject({
      isEoa: true,
      delegated7702: true,
    });
  });

  it("rolls capabilities up into the documented verdicts", () => {
    const base = { isEoa: false, delegated7702: false, canBurn: false, arbitraryCallSurface: false, upgradeable: false };
    expect(verdictOf({ ...base })).toBe("solid");
    expect(verdictOf({ ...base, canBurn: true })).toBe("burnable");
    expect(verdictOf({ ...base, upgradeable: true })).toBe("unstable");
    expect(verdictOf({ ...base, canBurn: true, arbitraryCallSurface: true })).toBe("ruggable");
    expect(verdictOf({ ...base, canBurn: true, upgradeable: true })).toBe("ruggable");
    expect(verdictOf({ ...base, isEoa: true })).toBe("eoa");
  });
});
