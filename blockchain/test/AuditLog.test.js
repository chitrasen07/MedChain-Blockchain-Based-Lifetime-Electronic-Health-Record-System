const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deploySystem, registerSamplePatient } = require("./helpers");

describe("AuditLog", function () {
  async function fixture() {
    return deploySystem();
  }

  it("creates audit entries and emits events", async function () {
    const ctx = await loadFixture(fixture);
    await expect(
      ctx.patientRegistry
        .connect(ctx.hospitalAdmin)
        .registerPatient("P100245", "did:medchain:abc123", ctx.patient.address)
    ).to.emit(ctx.auditLog, "AuditRecorded");

    expect(await ctx.auditLog.totalEntries()).to.equal(1);
    const entry = await ctx.auditLog.getEntry(0);
    expect(entry.actor).to.equal(ctx.hospitalAdmin.address);
    expect(entry.patientId).to.equal("P100245");
    expect(entry.action).to.equal("PATIENT_REGISTERED");
    expect(entry.success).to.equal(true);
    expect(entry.timestamp).to.be.gt(0);
  });

  it("records access and record actions", async function () {
    const ctx = await loadFixture(fixture);
    await registerSamplePatient(ctx);
    await ctx.recordAccess.connect(ctx.patient).grantAccess("P100245", ctx.doctor.address, 0);

    const { ethers } = require("hardhat");
    const hash = ethers.keccak256(ethers.toUtf8Bytes("off-chain-record-v1"));
    await ctx.medicalRecords.connect(ctx.doctor).registerRecordHash("REC-10001", "P100245", 2, hash);
    await ctx.medicalRecords.verifyRecordHash("REC-10001", hash);

    const total = await ctx.auditLog.totalEntries();
    expect(total).to.be.gte(4);

    const actions = [];
    for (let i = 0; i < total; i++) {
      const entry = await ctx.auditLog.getEntry(i);
      actions.push(entry.action);
    }
    expect(actions).to.include("PATIENT_REGISTERED");
    expect(actions).to.include("ACCESS_GRANTED");
    expect(actions).to.include("RECORD_CREATED");
    expect(actions).to.include("RECORD_VERIFIED");
  });

  it("cannot be modified or deleted", async function () {
    const ctx = await loadFixture(fixture);
    await registerSamplePatient(ctx);
    const before = await ctx.auditLog.getEntry(0);
    const fragmentNames = ctx.auditLog.interface.fragments
      .filter((fragment) => fragment.type === "function")
      .map((fragment) => fragment.name);

    expect(fragmentNames).to.not.include("updateEntry");
    expect(fragmentNames).to.not.include("deleteEntry");
    expect(fragmentNames).to.not.include("removeEntry");
    expect(fragmentNames).to.not.include("clear");

    await ctx.recordAccess.connect(ctx.patient).grantAccess("P100245", ctx.doctor.address, 0);
    const after = await ctx.auditLog.getEntry(0);
    expect(after.actor).to.equal(before.actor);
    expect(after.action).to.equal(before.action);
    expect(after.patientId).to.equal(before.patientId);
    expect(after.timestamp).to.equal(before.timestamp);
    expect(after.success).to.equal(before.success);
  });

  it("rejects unauthorized audit writers", async function () {
    const ctx = await loadFixture(fixture);
    await expect(
      ctx.auditLog.connect(ctx.stranger).recordAudit(ctx.stranger.address, "P100245", "ACCESS_GRANTED", "x", true)
    ).to.be.revertedWithCustomError(ctx.auditLog, "Unauthorized");
  });
});
