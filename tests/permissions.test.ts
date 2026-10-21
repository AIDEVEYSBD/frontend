import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLE_PERMISSIONS, can, permissionsFor } from "@/lib/permissions";

describe("roles map to permissions", () => {
  it("viewer holds exactly view", () => {
    expect(permissionsFor(["viewer"])).toEqual(["view"]);
    expect(ROLE_PERMISSIONS.viewer).toEqual(["view"]);
  });

  it("operator holds view, run and approve", () => {
    expect(permissionsFor(["operator"])).toEqual(["view", "run", "approve"]);
  });

  it("administrator holds every permission", () => {
    expect(permissionsFor(["administrator"])).toEqual([...PERMISSIONS]);
  });

  it("an unknown role grants nothing", () => {
    expect(permissionsFor(["auditor"])).toEqual([]);
    expect(permissionsFor([])).toEqual([]);
  });

  it("roles combine as a union, in the catalogue's order", () => {
    expect(permissionsFor(["viewer", "operator"])).toEqual(["view", "run", "approve"]);
  });

  it("the default role applies only when the token names none", () => {
    expect(permissionsFor([], "viewer")).toEqual(["view"]);
    expect(permissionsFor(["operator"], "administrator")).toEqual(["view", "run", "approve"]);
  });

  it("can() is membership", () => {
    expect(can(["view"], "view")).toBe(true);
    expect(can(["view"], "run")).toBe(false);
  });
});
