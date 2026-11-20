const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { deploySystem, registerSamplePatient } = require("./helpers");
const { recordContentHash } = require("../../backend/src/clinicalRecords");
const { reasonHash } = require("../../backend/src/consentChain");

describe("consent and emergency access", function () {
  async function fixture() {
    const ctx = await deploySystem();
    const patientRef = await registerSamplePatient(ctx);
    return { ...ctx, patientRef };
  }

  it("lets only the controller grant consent and drops access as soon as it ends", async function () {
    const ctx = await loadFixture(fixture);
    const recordRef = ethers.hexlify(ethers.randomBytes(32));
    const hash = recordContentHash({ category: "diagnosis", condition: "Seasonal rhinitis", recordedOn: "2026-03-01" });
    await expect(
      ctx.recordAccess.connect(ctx.hospitalAdmin).grantAccess(ctx.patientRef, ctx.doctor.address, 0)
    ).to.be.revertedWithCustomError(ctx.recordAccess, "Unauthorized");
    await expect(
      ctx.medicalRecords.connect(ctx.doctor).createRecord(recordRef, ctx.patientRef, hash, 0)
    ).to.be.revertedWithCustomError(ctx.medicalRecords, "Unauthorized");

    const expiresAt = (await time.latest()) + 60;
    await ctx.recordAccess.connect(ctx.patient).grantAccess(ctx.patientRef, ctx.doctor.address, expiresAt);
    expect(await ctx.recordAccess.hasAccess(ctx.patientRef, ctx.doctor.address)).to.equal(true);
    expect(await ctx.recordAccess.hasAccess(ctx.patientRef, ctx.stranger.address)).to.equal(false);
    await ctx.medicalRecords.connect(ctx.doctor).createRecord(recordRef, ctx.patientRef, hash, 0);

    await ctx.recordAccess.connect(ctx.patient).revokeAccess(ctx.patientRef, ctx.doctor.address);
    expect(await ctx.recordAccess.hasAccess(ctx.patientRef, ctx.doctor.address)).to.equal(false);
    await expect(
      ctx.medicalRecords.connect(ctx.doctor).appendRecordVersion(recordRef, hash, 0)
    ).to.be.revertedWithCustomError(ctx.medicalRecords, "Unauthorized");

    const secondRef = ethers.hexlify(ethers.randomBytes(32));
    await ctx.recordAccess.connect(ctx.patient).grantAccess(ctx.patientRef, ctx.doctor.address, (await time.latest()) + 30);
    await time.increase(31);
    expect(await ctx.recordAccess.hasAccess(ctx.patientRef, ctx.doctor.address)).to.equal(false);
    await expect(
      ctx.medicalRecords.connect(ctx.doctor).createRecord(secondRef, ctx.patientRef, hash, 0)
    ).to.be.revertedWithCustomError(ctx.medicalRecords, "Unauthorized");
  });

  it("bounds emergency access to a responder hash and keeps the reason off the transaction", async function () {
    const ctx = await loadFixture(fixture);
    const reason = "Unconscious patient needs the allergy list";
    const hashed = reasonHash(reason);
    expect(hashed).to.equal(reasonHash(reason));
    await expect(
      ctx.emergencyAccess.connect(ctx.hospitalAdmin).requestEmergencyAccess(ctx.patientRef, hashed, 3600)
    ).to.be.revertedWithCustomError(ctx.emergencyAccess, "Unauthorized");
    await expect(
      ctx.emergencyAccess.connect(ctx.stranger).requestEmergencyAccess(ctx.patientRef, hashed, 3600)
    ).to.be.revertedWithCustomError(ctx.emergencyAccess, "Unauthorized");
    const tooLong = (await ctx.emergencyAccess.MAX_DURATION()) + 1n;
    await expect(
      ctx.emergencyAccess.connect(ctx.doctor).requestEmergencyAccess(ctx.patientRef, hashed, tooLong)
    ).to.be.revertedWithCustomError(ctx.emergencyAccess, "InvalidDuration");

    const tx = await ctx.emergencyAccess.connect(ctx.doctor).requestEmergencyAccess(ctx.patientRef, hashed, 60);
    const receipt = await tx.wait();
    const encoded = receipt.data || tx.data;
    expect(encoded.toLowerCase()).to.not.include(ethers.toUtf8Bytes(reason).reduce((hex, byte) => hex + byte.toString(16).padStart(2, "0"), ""));
    expect(await ctx.emergencyAccess.checkEmergencyAccess(ctx.patientRef, ctx.doctor.address)).to.equal(true);
    const recordRef = ethers.hexlify(ethers.randomBytes(32));
    const hash = recordContentHash({ category: "allergy", substance: "Penicillin", recordedOn: "2026-03-01" });
    await ctx.medicalRecords.connect(ctx.doctor).createRecord(recordRef, ctx.patientRef, hash, 0);
    await time.increase(61);
    expect(await ctx.emergencyAccess.checkEmergencyAccess(ctx.patientRef, ctx.doctor.address)).to.equal(false);
    await expect(
      ctx.medicalRecords.connect(ctx.doctor).appendRecordVersion(recordRef, hash, 0)
    ).to.be.revertedWithCustomError(ctx.medicalRecords, "Unauthorized");
    await expect(
      ctx.emergencyAccess.connect(ctx.doctor).requestEmergencyAccess(ctx.patientRef, hashed, 60)
    ).to.be.revertedWithCustomError(ctx.emergencyAccess, "EmergencyCooldown");

    const before = await ctx.auditLog.totalEntries();
    expect(before).to.be.greaterThan(0n);
    const latest = await ctx.auditLog.getEntry(before - 1n);
    expect(latest.actionCode).to.not.equal(ethers.ZeroHash);
  });
});
