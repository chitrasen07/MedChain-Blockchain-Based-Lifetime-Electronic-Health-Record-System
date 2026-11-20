const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { deploySystem, claimCommitment, sealedClaim } = require("./helpers");
const { recordContentHash } = require("../../backend/src/clinicalRecords");

describe("lifetime record integration", function () {
  async function fixture() {
    return deploySystem();
  }

  it("anchors only a consented doctor hash and keeps the clinical text off the transaction", async function () {
    const ctx = await loadFixture(fixture);
    const patientRef = ethers.hexlify(ethers.randomBytes(32));
    const secret = ethers.hexlify(ethers.randomBytes(32));
    await ctx.patientRegistry.connect(ctx.hospitalAdmin).registerPatient(
      patientRef,
      ethers.ZeroAddress,
      ethers.hexlify(ethers.randomBytes(32)),
      claimCommitment(secret)
    );
    await ctx.patientRegistry.connect(ctx.patient).announceControllerClaim(
      patientRef,
      sealedClaim(ctx.patient.address, secret, patientRef)
    );
    await expect(
      ctx.patientRegistry.connect(ctx.patient).revealControllerClaim(patientRef, secret)
    ).to.be.revertedWithCustomError(ctx.patientRegistry, "ClaimTooEarly");
    await time.increase(3600);
    await ctx.patientRegistry.connect(ctx.patient).revealControllerClaim(patientRef, secret);
    expect(await ctx.patientRegistry.getController(patientRef)).to.equal(ctx.patient.address);

    const content = {
      category: "diagnosis",
      condition: "Seasonal rhinitis",
      notes: "Off-chain only",
      recordedOn: "2026-03-01"
    };
    const hash = recordContentHash(content);
    const recordRef = ethers.hexlify(ethers.randomBytes(32));
    await expect(
      ctx.medicalRecords.connect(ctx.hospitalAdmin).createRecord(recordRef, patientRef, hash, 0)
    ).to.be.revertedWithCustomError(ctx.medicalRecords, "Unauthorized");
    await expect(
      ctx.medicalRecords.connect(ctx.doctor).createRecord(recordRef, patientRef, hash, 0)
    ).to.be.revertedWithCustomError(ctx.medicalRecords, "Unauthorized");

    await ctx.recordAccess.connect(ctx.patient).grantAccess(patientRef, ctx.doctor.address, 0);
    const tx = await ctx.medicalRecords.connect(ctx.doctor).createRecord(recordRef, patientRef, hash, 0);
    const receipt = await tx.wait();
    const input = receipt.data || tx.data;
    expect(input.toLowerCase()).to.not.include(ethers.toUtf8Bytes("Seasonal rhinitis").reduce((hex, byte) => hex + byte.toString(16).padStart(2, "0"), ""));
    expect((await ctx.medicalRecords.getVersion(recordRef, 0)).recordHash).to.equal(hash);

    const revised = recordContentHash({ ...content, notes: "Reviewed" });
    await ctx.medicalRecords.connect(ctx.doctor).appendRecordVersion(recordRef, revised, 0);
    expect((await ctx.medicalRecords.getVersion(recordRef, 0)).recordHash).to.equal(hash);
    expect((await ctx.medicalRecords.getVersion(recordRef, 1)).recordHash).to.equal(revised);
    expect(await ctx.medicalRecords.connect(ctx.doctor).verifyRecordHash.staticCall(recordRef, 1, revised)).to.equal(true);
  });
});
