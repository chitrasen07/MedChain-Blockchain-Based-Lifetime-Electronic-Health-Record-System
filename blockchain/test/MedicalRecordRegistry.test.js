const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deploySystem, registerSamplePatient } = require("./helpers");

const DIAGNOSIS = 2;
const sampleHash = ethers.keccak256(ethers.toUtf8Bytes("off-chain-record-v1"));
const otherHash = ethers.keccak256(ethers.toUtf8Bytes("off-chain-record-v2"));

describe("MedicalRecordRegistry", function () {
  async function fixture() {
    const ctx = await deploySystem();
    await registerSamplePatient(ctx);
    await ctx.recordAccess.connect(ctx.patient).grantAccess("P100245", ctx.doctor.address, 0);
    return ctx;
  }

  it("creates a record hash", async function () {
    const ctx = await loadFixture(fixture);
    await expect(
      ctx.medicalRecords.connect(ctx.doctor).registerRecordHash("REC-10001", "P100245", DIAGNOSIS, sampleHash)
    ).to.emit(ctx.medicalRecords, "MedicalRecordCreated");

    expect(await ctx.medicalRecords.getRecordHash("REC-10001")).to.equal(sampleHash);
  });

  it("registers and verifies a historical record with separate dates", async function () {
    const ctx = await loadFixture(fixture);
    const recordDate = 1104537600n;

    await ctx.medicalRecords
      .connect(ctx.doctor)
      .registerHistoricalRecordHash("REC-HIST-001", "P100245", DIAGNOSIS, sampleHash, recordDate);

    const metadata = await ctx.medicalRecords.getRecordMetadata("REC-HIST-001");
    expect(metadata.recordOrigin).to.equal(1n);
    expect(metadata.recordDate).to.equal(recordDate);
    expect(metadata.registeredAt).to.be.gt(recordDate);
    expect(await ctx.medicalRecords.getRecordHash("REC-HIST-001")).to.equal(sampleHash);
    expect(await ctx.medicalRecords.verifyRecordHash.staticCall("REC-HIST-001", sampleHash)).to.equal(true);
  });

  it("rejects unauthorized historical record creation", async function () {
    const ctx = await loadFixture(fixture);
    await expect(
      ctx.medicalRecords
        .connect(ctx.stranger)
        .registerHistoricalRecordHash("REC-HIST-002", "P100245", DIAGNOSIS, sampleHash, 1104537600n)
    ).to.be.revertedWithCustomError(ctx.medicalRecords, "Unauthorized");
  });

  it("rejects duplicate record IDs", async function () {
    const ctx = await loadFixture(fixture);
    await ctx.medicalRecords.connect(ctx.doctor).registerRecordHash("REC-10001", "P100245", DIAGNOSIS, sampleHash);
    await expect(
      ctx.medicalRecords.connect(ctx.doctor).registerRecordHash("REC-10001", "P100245", DIAGNOSIS, otherHash)
    ).to.be.revertedWithCustomError(ctx.medicalRecords, "RecordAlreadyExists");
  });

  it("rejects unauthorized creation", async function () {
    const ctx = await loadFixture(fixture);
    await expect(
      ctx.medicalRecords.connect(ctx.stranger).registerRecordHash("REC-10002", "P100245", DIAGNOSIS, sampleHash)
    ).to.be.revertedWithCustomError(ctx.medicalRecords, "Unauthorized");
    await expect(
      ctx.medicalRecords.connect(ctx.nurse).registerRecordHash("REC-10002", "P100245", DIAGNOSIS, sampleHash)
    ).to.be.revertedWithCustomError(ctx.medicalRecords, "Unauthorized");
  });

  it("updates a record hash", async function () {
    const ctx = await loadFixture(fixture);
    await ctx.medicalRecords.connect(ctx.doctor).registerRecordHash("REC-10001", "P100245", DIAGNOSIS, sampleHash);
    await expect(ctx.medicalRecords.connect(ctx.doctor).updateRecordHash("REC-10001", otherHash))
      .to.emit(ctx.medicalRecords, "MedicalRecordUpdated");
    expect(await ctx.medicalRecords.getRecordHash("REC-10001")).to.equal(otherHash);
  });

  it("rejects unauthorized updates", async function () {
    const ctx = await loadFixture(fixture);
    await ctx.medicalRecords.connect(ctx.doctor).registerRecordHash("REC-10001", "P100245", DIAGNOSIS, sampleHash);
    await expect(
      ctx.medicalRecords.connect(ctx.stranger).updateRecordHash("REC-10001", otherHash)
    ).to.be.revertedWithCustomError(ctx.medicalRecords, "Unauthorized");
    await expect(
      ctx.medicalRecords.connect(ctx.nurse).updateRecordHash("REC-10001", otherHash)
    ).to.be.revertedWithCustomError(ctx.medicalRecords, "Unauthorized");
  });

  it("verifies a correct hash", async function () {
    const ctx = await loadFixture(fixture);
    await ctx.medicalRecords.connect(ctx.doctor).registerRecordHash("REC-10001", "P100245", DIAGNOSIS, sampleHash);
    expect(await ctx.medicalRecords.verifyRecordHash.staticCall("REC-10001", sampleHash)).to.equal(true);
    await ctx.medicalRecords.verifyRecordHash("REC-10001", sampleHash);
  });

  it("rejects an incorrect hash", async function () {
    const ctx = await loadFixture(fixture);
    await ctx.medicalRecords.connect(ctx.doctor).registerRecordHash("REC-10001", "P100245", DIAGNOSIS, sampleHash);
    expect(await ctx.medicalRecords.verifyRecordHash.staticCall("REC-10001", otherHash)).to.equal(false);
  });

  it("deactivates a record", async function () {
    const ctx = await loadFixture(fixture);
    await ctx.medicalRecords.connect(ctx.doctor).registerRecordHash("REC-10001", "P100245", DIAGNOSIS, sampleHash);
    await expect(ctx.medicalRecords.connect(ctx.doctor).deactivateRecord("REC-10001"))
      .to.emit(ctx.medicalRecords, "MedicalRecordDeactivated");
    const record = await ctx.medicalRecords.getRecord("REC-10001");
    expect(record.active).to.equal(false);
    expect(await ctx.medicalRecords.verifyRecordHash.staticCall("REC-10001", sampleHash)).to.equal(false);
  });
});
