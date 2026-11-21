import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nursingBody, nursingIssues } from "../src/lib/nursingForm.js";

describe("nursing intake validation", () => {
  it("accepts a complete vital set and omits empty measurements", () => {
    const fields = {
      bloodPressure: "120/80",
      heartRate: "72",
      temperature: "36.8",
      spo2: "98",
      respiratoryRate: "16",
      height: "170",
      weight: "65",
      notes: "",
    };
    assert.equal(nursingIssues("vital", fields, "2026-11-20"), "");
    const body = nursingBody("vital", "2026-11-20", fields);
    assert.equal(Object.hasOwn(body.fields, "notes"), false);
    assert.equal(body.fields.bloodPressure, "120/80");
  });

  it("rejects an empty vital form and an implausible blood pressure", () => {
    assert.match(nursingIssues("vital", {}, "2026-11-20"), /at least one vital/);
    assert.match(nursingIssues("vital", { bloodPressure: "80/90" }, "2026-11-20"), /Blood pressure/);
  });

  it("requires a check-in time and reason for a visit note", () => {
    assert.match(nursingIssues("visit_note", { reason: "Check-in" }, "2026-11-20"), /check-in time/);
    assert.equal(nursingIssues("visit_note", {
      checkInAt: "2026-11-20T09:00:00.000Z",
      reason: "Check-in",
      symptoms: "Headache",
      observations: "Alert",
    }, "2026-11-20"), "");
  });

  it("keeps a laboratory report pending until the required result is entered", () => {
    assert.match(nursingIssues("laboratory", { testName: "Hemoglobin" }, "2026-11-20"), /result/);
    assert.equal(nursingIssues("laboratory", { testName: "Hemoglobin", result: "13.2", unit: "g/dL" }, "2026-11-20"), "");
  });
});
