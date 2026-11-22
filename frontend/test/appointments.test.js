import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appointmentNotice, hospitalToday, visitLine } from "../src/lib/appointments.js";

describe("appointment notices", () => {
  it("tells the patient when a doctor confirms, moves, rejects, or cancels", () => {
    assert.equal(appointmentNotice("pending", { status: "confirmed" }), "Your appointment has been confirmed.");
    assert.equal(appointmentNotice("confirmed", { status: "rescheduled" }), "Your appointment has been rescheduled.");
    assert.equal(appointmentNotice("pending", { status: "rejected" }), "Your appointment request was rejected.");
    assert.equal(appointmentNotice("confirmed", { status: "cancelled" }), "Your appointment was cancelled.");
    assert.equal(appointmentNotice(undefined, { status: "confirmed" }), "");
    assert.equal(appointmentNotice("confirmed", { status: "confirmed" }), "");
  });

  it("states when and where a confirmed visit happens", () => {
    const line = visitLine({
      hospitalName: "City Hospital",
      department: "Medicine",
      room: "12",
      confirmedDate: "15 Jan 2027",
      confirmedTime: "10:00",
    });
    assert.equal(line, "Visit City Hospital, Medicine, Room 12 on 15 Jan 2027 at 10:00.");
  });

  it("uses the hospital calendar day", () => {
    assert.equal(hospitalToday(new Date("2027-01-15T20:30:00.000Z")), "2027-01-16");
  });
});
