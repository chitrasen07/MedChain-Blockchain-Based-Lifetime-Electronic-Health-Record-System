const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const {
  deploySystem,
  registerSamplePatient,
  commitmentFor,
  claimCommitment,
  sealedClaim,
  recoveryCommitment,
  sealedRecovery
} = require("./helpers");

const sampleHash = ethers.keccak256(ethers.toUtf8Bytes("off-chain-record-v1"));
const nextHash = ethers.keccak256(ethers.toUtf8Bytes("off-chain-record-v2"));
const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("break-glass-reason"));

async function unclaimedPatient(ctx) {
  const patientRef = ethers.hexlify(ethers.randomBytes(32));
  const secret = ethers.hexlify(ethers.randomBytes(32));
  await ctx.patientRegistry.connect(ctx.hospitalAdmin).registerPatient(
    patientRef,
    ethers.ZeroAddress,
    commitmentFor(patientRef, "unclaimed"),
    claimCommitment(secret)
  );
  return { patientRef, secret };
}

describe("contract security", function () {
  async function fixture() {
    return deploySystem();
  }

  it("prevents a hospital administrator from granting or revoking consent", async function () {
    const ctx = await loadFixture(fixture);
    const patientRef = await registerSamplePatient(ctx);

    await expect(
      ctx.recordAccess.connect(ctx.hospitalAdmin).grantAccess(patientRef, ctx.doctor.address, 0)
    ).to.be.revertedWithCustomError(ctx.recordAccess, "Unauthorized");

    await ctx.recordAccess.connect(ctx.patient).grantAccess(patientRef, ctx.doctor.address, 0);
    await expect(
      ctx.recordAccess.connect(ctx.hospitalAdmin).revokeAccess(patientRef, ctx.doctor.address)
    ).to.be.revertedWithCustomError(ctx.recordAccess, "Unauthorized");
    await ctx.recordAccess.connect(ctx.patient).revokeAccess(patientRef, ctx.doctor.address);
    expect(await ctx.recordAccess.hasAccess(patientRef, ctx.doctor.address)).to.equal(false);
  });

  it("claims, transfers, and recovers a controller only for an authorized wallet", async function () {
    const ctx = await loadFixture(fixture);
    const { patientRef, secret } = await unclaimedPatient(ctx);

    await expect(
      ctx.patientRegistry.connect(ctx.hospitalAdmin).proposeControllerTransfer(patientRef, ctx.hospitalAdmin.address)
    ).to.be.revertedWithCustomError(ctx.patientRegistry, "Unauthorized");

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

    await expect(
      ctx.patientRegistry.connect(ctx.stranger).proposeControllerTransfer(patientRef, ctx.stranger.address)
    ).to.be.revertedWithCustomError(ctx.patientRegistry, "Unauthorized");
    await ctx.patientRegistry.connect(ctx.patient).proposeControllerTransfer(patientRef, ctx.extra.address);
    await expect(
      ctx.patientRegistry.connect(ctx.stranger).acceptControllerTransfer(patientRef)
    ).to.be.revertedWithCustomError(ctx.patientRegistry, "Unauthorized");
    await ctx.patientRegistry.connect(ctx.extra).acceptControllerTransfer(patientRef);
    expect(await ctx.patientRegistry.getController(patientRef)).to.equal(ctx.extra.address);

    const recoverySecret = ethers.hexlify(ethers.randomBytes(32));
    await ctx.patientRegistry.connect(ctx.extra).setRecoveryCommitment(patientRef, recoveryCommitment(recoverySecret));
    await ctx.patientRegistry.connect(ctx.patient).announceControllerRecovery(
      patientRef,
      sealedRecovery(ctx.patient.address, recoverySecret, patientRef)
    );
    await time.increase(3600);
    await ctx.patientRegistry.connect(ctx.patient).revealControllerRecovery(patientRef, recoverySecret);
    expect(await ctx.patientRegistry.getController(patientRef)).to.equal(ctx.patient.address);
    await expect(
      ctx.patientRegistry.connect(ctx.stranger).announceControllerRecovery(
        patientRef,
        sealedRecovery(ctx.stranger.address, recoverySecret, patientRef)
      )
    ).to.be.revertedWithCustomError(ctx.patientRegistry, "InvalidClaim");
  });

  it("ends record authority when emergency access ends and blocks an immediate extension", async function () {
    const ctx = await loadFixture(fixture);
    const patientRef = await registerSamplePatient(ctx);
    const recordRef = ethers.keccak256(ethers.toUtf8Bytes("emergency-record"));

    await ctx.emergencyAccess.connect(ctx.doctor).requestEmergencyAccess(patientRef, reasonHash, 60);
    await ctx.medicalRecords.connect(ctx.doctor).createRecord(recordRef, patientRef, sampleHash, 0);
    await time.increase(61);

    expect(await ctx.emergencyAccess.checkEmergencyAccess(patientRef, ctx.doctor.address)).to.equal(false);
    await expect(
      ctx.medicalRecords.connect(ctx.doctor).appendRecordVersion(recordRef, nextHash, 0)
    ).to.be.revertedWithCustomError(ctx.medicalRecords, "Unauthorized");
    await expect(
      ctx.emergencyAccess.connect(ctx.doctor).requestEmergencyAccess(patientRef, reasonHash, 60)
    ).to.be.revertedWithCustomError(ctx.emergencyAccess, "EmergencyCooldown");
    expect((await ctx.medicalRecords.getVersion(recordRef, 0)).recordHash).to.equal(sampleHash);
  });

  it("emits one role-revoked event and keeps the last super administrator", async function () {
    const ctx = await loadFixture(fixture);
    const superAdmin = await ctx.roleManager.SUPER_ADMIN_ROLE();
    const doctorRole = await ctx.roleManager.DOCTOR_ROLE();
    const tx = await ctx.roleManager.connect(ctx.hospitalAdmin).revokeRole(doctorRole, ctx.doctor.address);
    const receipt = await tx.wait();
    const revoked = receipt.logs.filter((log) => {
      try {
        return ctx.roleManager.interface.parseLog(log).name === "RoleRevoked";
      } catch {
        return false;
      }
    });

    expect(revoked).to.have.length(1);
    await expect(
      ctx.roleManager.connect(ctx.deployer).renounceRole(superAdmin, ctx.deployer.address)
    ).to.be.revertedWithCustomError(ctx.roleManager, "LastSuperAdmin");
    await ctx.roleManager.connect(ctx.deployer).assignRole(superAdmin, ctx.extra.address);
    await ctx.roleManager.connect(ctx.deployer).revokeRole(superAdmin, ctx.extra.address);
    expect(await ctx.roleManager.superAdminCount()).to.equal(1);
  });
});
