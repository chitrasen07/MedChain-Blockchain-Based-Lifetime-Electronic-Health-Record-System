const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deploySystem, registerSamplePatient } = require("./helpers");

describe("EmergencyAccess", function () {
  async function fixture() {
    const ctx = await deploySystem();
    await registerSamplePatient(ctx);
    return ctx;
  }

  const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("unconscious-emergency-ref"));

  it("allows an authorized doctor to request emergency access", async function () {
    const ctx = await loadFixture(fixture);
    await expect(ctx.emergencyAccess.connect(ctx.doctor).requestEmergencyAccess("P100245", reasonHash, 3600))
      .to.emit(ctx.emergencyAccess, "EmergencyAccessRequested")
      .and.to.emit(ctx.emergencyAccess, "EmergencyAccessGranted");

    expect(await ctx.emergencyAccess.checkEmergencyAccess("P100245", ctx.doctor.address)).to.equal(true);
  });

  it("rejects unauthorized emergency requests", async function () {
    const ctx = await loadFixture(fixture);
    await expect(
      ctx.emergencyAccess.connect(ctx.stranger).requestEmergencyAccess("P100245", reasonHash, 3600)
    ).to.be.revertedWithCustomError(ctx.emergencyAccess, "Unauthorized");
  });

  it("expires emergency access automatically", async function () {
    const ctx = await loadFixture(fixture);
    await ctx.emergencyAccess.connect(ctx.doctor).requestEmergencyAccess("P100245", reasonHash, 60);
    expect(await ctx.emergencyAccess.checkEmergencyAccess("P100245", ctx.doctor.address)).to.equal(true);
    await time.increase(61);
    expect(await ctx.emergencyAccess.checkEmergencyAccess("P100245", ctx.doctor.address)).to.equal(false);
    await expect(ctx.emergencyAccess.expireEmergencyAccess("P100245", ctx.doctor.address))
      .to.emit(ctx.emergencyAccess, "EmergencyAccessExpired");
  });

  it("revokes emergency access", async function () {
    const ctx = await loadFixture(fixture);
    await ctx.emergencyAccess.connect(ctx.doctor).requestEmergencyAccess("P100245", reasonHash, 3600);
    await expect(ctx.emergencyAccess.connect(ctx.hospitalAdmin).revokeEmergencyAccess("P100245", ctx.doctor.address))
      .to.emit(ctx.emergencyAccess, "EmergencyAccessRevoked");
    expect(await ctx.emergencyAccess.checkEmergencyAccess("P100245", ctx.doctor.address)).to.equal(false);
  });

  it("rejects invalid durations", async function () {
    const ctx = await loadFixture(fixture);
    await expect(
      ctx.emergencyAccess.connect(ctx.doctor).requestEmergencyAccess("P100245", reasonHash, 0)
    ).to.be.revertedWithCustomError(ctx.emergencyAccess, "InvalidDuration");
    const tooLong = (await ctx.emergencyAccess.MAX_DURATION()) + 1n;
    await expect(
      ctx.emergencyAccess.connect(ctx.doctor).requestEmergencyAccess("P100245", reasonHash, tooLong)
    ).to.be.revertedWithCustomError(ctx.emergencyAccess, "InvalidDuration");
  });
});
