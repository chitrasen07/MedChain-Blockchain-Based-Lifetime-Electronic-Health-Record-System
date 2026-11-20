const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deploySystem, registerSamplePatient } = require("./helpers");

const sampleHash = ethers.keccak256(ethers.toUtf8Bytes("off-chain-record-v1"));
const otherHash = ethers.keccak256(ethers.toUtf8Bytes("off-chain-record-v2"));
const recordRef = ethers.keccak256(ethers.toUtf8Bytes("record-ref-1"));
const historicalRef = ethers.keccak256(ethers.toUtf8Bytes("record-ref-historical"));

describe("MedicalRecordRegistry", function () {
  async function fixture() {
    const ctx = await deploySystem();
    ctx.patientId = await registerSamplePatient(ctx);
    await ctx.recordAccess.connect(ctx.patient).grantAccess(ctx.patientId, ctx.doctor.address, 0);
    return ctx;
  }

  it("creates a record hash without a clinical type", async function () {
    const ctx = await loadFixture(fixture);

    await expect(
      ctx.medicalRecords.connect(ctx.doctor).createRecord(recordRef, ctx.patientId, sampleHash, 0)
    ).to.emit(ctx.medicalRecords, "RecordVersionAppended");

    const version = await ctx.medicalRecords.getVersion(recordRef, 0);
    expect(version.recordHash).to.equal(sampleHash);
    expect(ctx.medicalRecords.interface.fragments.map((item) => item.name)).to.not.include("registerRecordHash");
  });

  it("keeps a historical date on the first version", async function () {
    const ctx = await loadFixture(fixture);
    const recordDate = 1104537600n;

    await ctx.medicalRecords.connect(ctx.doctor).createRecord(historicalRef, ctx.patientId, sampleHash, recordDate);
    const version = await ctx.medicalRecords.getVersion(historicalRef, 0);

    expect(version.recordDate).to.equal(recordDate);
    expect(version.registeredAt).to.be.gt(recordDate);
    expect(
      await ctx.medicalRecords.connect(ctx.doctor).verifyRecordHash.staticCall(historicalRef, 0, sampleHash)
    ).to.equal(true);
  });

  it("rejects unauthorized creation", async function () {
    const ctx = await loadFixture(fixture);
    const ref = ethers.keccak256(ethers.toUtf8Bytes("record-ref-denied"));

    await expect(
      ctx.medicalRecords.connect(ctx.stranger).createRecord(ref, ctx.patientId, sampleHash, 0)
    ).to.be.revertedWithCustomError(ctx.medicalRecords, "Unauthorized");
    await expect(
      ctx.medicalRecords.connect(ctx.nurse).createRecord(ref, ctx.patientId, sampleHash, 0)
    ).to.be.revertedWithCustomError(ctx.medicalRecords, "Unauthorized");
    await expect(
      ctx.medicalRecords.connect(ctx.hospitalAdmin).createRecord(ref, ctx.patientId, sampleHash, 0)
    ).to.be.revertedWithCustomError(ctx.medicalRecords, "Unauthorized");
  });

  it("rejects a second create for the same reference", async function () {
    const ctx = await loadFixture(fixture);
    await ctx.medicalRecords.connect(ctx.doctor).createRecord(recordRef, ctx.patientId, sampleHash, 0);

    await expect(
      ctx.medicalRecords.connect(ctx.doctor).createRecord(recordRef, ctx.patientId, otherHash, 0)
    ).to.be.revertedWithCustomError(ctx.medicalRecords, "RecordAlreadyExists");
  });

  it("appends a version and preserves the previous hash", async function () {
    const ctx = await loadFixture(fixture);
    await ctx.medicalRecords.connect(ctx.doctor).createRecord(recordRef, ctx.patientId, sampleHash, 0);

    await expect(ctx.medicalRecords.connect(ctx.doctor).appendRecordVersion(recordRef, otherHash, 0))
      .to.emit(ctx.medicalRecords, "RecordVersionAppended");

    expect((await ctx.medicalRecords.getVersion(recordRef, 0)).recordHash).to.equal(sampleHash);
    expect((await ctx.medicalRecords.getVersion(recordRef, 1)).recordHash).to.equal(otherHash);
    expect(await ctx.medicalRecords.versionCount(recordRef)).to.equal(2);
  });

  it("rejects unauthorized version appends", async function () {
    const ctx = await loadFixture(fixture);
    await ctx.medicalRecords.connect(ctx.doctor).createRecord(recordRef, ctx.patientId, sampleHash, 0);

    await expect(ctx.medicalRecords.connect(ctx.stranger).appendRecordVersion(recordRef, otherHash, 0))
      .to.be.revertedWithCustomError(ctx.medicalRecords, "Unauthorized");
    await expect(ctx.medicalRecords.connect(ctx.nurse).appendRecordVersion(recordRef, otherHash, 0))
      .to.be.revertedWithCustomError(ctx.medicalRecords, "Unauthorized");
  });

  it("verifies a matching hash and reports a different hash", async function () {
    const ctx = await loadFixture(fixture);
    await ctx.medicalRecords.connect(ctx.doctor).createRecord(recordRef, ctx.patientId, sampleHash, 0);

    expect(await ctx.medicalRecords.connect(ctx.doctor).verifyRecordHash.staticCall(recordRef, 0, sampleHash))
      .to.equal(true);
    expect(await ctx.medicalRecords.connect(ctx.doctor).verifyRecordHash.staticCall(recordRef, 0, otherHash))
      .to.equal(false);
  });

  it("deactivates a record without deleting its versions", async function () {
    const ctx = await loadFixture(fixture);
    await ctx.medicalRecords.connect(ctx.doctor).createRecord(recordRef, ctx.patientId, sampleHash, 0);

    await expect(ctx.medicalRecords.connect(ctx.doctor).deactivateRecord(recordRef))
      .to.emit(ctx.medicalRecords, "RecordDeactivated");

    const record = await ctx.medicalRecords.getRecord(recordRef);
    expect(record.active).to.equal(false);
    expect((await ctx.medicalRecords.getVersion(recordRef, 0)).recordHash).to.equal(sampleHash);
  });
});
