const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deploySystem, registerSamplePatient } = require("./helpers");

function action(name) {
  return ethers.keccak256(ethers.toUtf8Bytes(name));
}

describe("AuditLog", function () {
  async function fixture() {
    return deploySystem();
  }

  it("records opaque subjects and action codes", async function () {
    const ctx = await loadFixture(fixture);
    const patientRef = await registerSamplePatient(ctx);
    const entry = await ctx.auditLog.getEntry(0);

    expect(entry.actor).to.equal(ctx.hospitalAdmin.address);
    expect(entry.subject).to.equal(patientRef);
    expect(entry.actionCode).to.equal(action("PATIENT_REGISTERED"));
    expect(entry.success).to.equal(true);
    expect(entry).to.not.have.property("patientId");
  });

  it("records access and record action codes", async function () {
    const ctx = await loadFixture(fixture);
    const patientRef = await registerSamplePatient(ctx);
    await ctx.recordAccess.connect(ctx.patient).grantAccess(patientRef, ctx.doctor.address, 0);
    const recordRef = ethers.keccak256(ethers.toUtf8Bytes("audit-record"));
    const hash = ethers.keccak256(ethers.toUtf8Bytes("off-chain-record-v1"));
    await ctx.medicalRecords.connect(ctx.doctor).createRecord(recordRef, patientRef, hash, 0);
    await ctx.medicalRecords.connect(ctx.doctor).verifyRecordHash(recordRef, 0, hash);

    const codes = [];
    const total = await ctx.auditLog.totalEntries();
    for (let i = 0; i < total; i++) codes.push((await ctx.auditLog.getEntry(i)).actionCode);

    expect(codes).to.include(action("PATIENT_REGISTERED"));
    expect(codes).to.include(action("ACCESS_GRANTED"));
    expect(codes).to.include(action("RECORD_CREATED"));
    expect(codes).to.include(action("RECORD_VERIFIED"));
  });

  it("cannot be modified or deleted", async function () {
    const ctx = await loadFixture(fixture);
    const patientRef = await registerSamplePatient(ctx);
    const before = await ctx.auditLog.getEntry(0);
    const names = ctx.auditLog.interface.fragments.filter((item) => item.type === "function").map((item) => item.name);

    expect(names).to.not.include("updateEntry");
    expect(names).to.not.include("deleteEntry");
    await ctx.recordAccess.connect(ctx.patient).grantAccess(patientRef, ctx.doctor.address, 0);
    const after = await ctx.auditLog.getEntry(0);

    expect(after.subject).to.equal(before.subject);
    expect(after.actionCode).to.equal(before.actionCode);
    expect(after.timestamp).to.equal(before.timestamp);
  });

  it("rejects unauthorized audit writers and does not authorize the deployer automatically", async function () {
    const ctx = await loadFixture(fixture);

    expect(await ctx.auditLog.authorizedLoggers(ctx.deployer.address)).to.equal(false);
    await expect(
      ctx.auditLog.connect(ctx.stranger).recordAudit(
        ctx.stranger.address,
        ethers.hexlify(ethers.randomBytes(32)),
        action("ACCESS_GRANTED"),
        true
      )
    ).to.be.revertedWithCustomError(ctx.auditLog, "Unauthorized");
  });
});
