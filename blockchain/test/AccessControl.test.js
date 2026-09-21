const { expect } = require("chai");
const { time, loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deploySystem, registerSamplePatient } = require("./helpers");

describe("AccessControl", function () {
  async function fixture() {
    const ctx = await deploySystem();
    await registerSamplePatient(ctx);
    return ctx;
  }

  it("grants access", async function () {
    const ctx = await loadFixture(fixture);
    await expect(ctx.recordAccess.connect(ctx.patient).grantAccess("P100245", ctx.doctor.address, 0))
      .to.emit(ctx.recordAccess, "AccessGranted");
    expect(await ctx.recordAccess.hasAccess("P100245", ctx.doctor.address)).to.equal(true);
  });

  it("verifies access", async function () {
    const ctx = await loadFixture(fixture);
    expect(await ctx.recordAccess.hasAccess("P100245", ctx.doctor.address)).to.equal(false);
    await ctx.recordAccess.connect(ctx.hospitalAdmin).grantAccess("P100245", ctx.doctor.address, 0);
    expect(await ctx.recordAccess.hasAccess("P100245", ctx.doctor.address)).to.equal(true);
    expect(await ctx.recordAccess.getAccessExpiry("P100245", ctx.doctor.address)).to.equal(0);
  });

  it("revokes access", async function () {
    const ctx = await loadFixture(fixture);
    await ctx.recordAccess.connect(ctx.patient).grantAccess("P100245", ctx.doctor.address, 0);
    await expect(ctx.recordAccess.connect(ctx.patient).revokeAccess("P100245", ctx.doctor.address))
      .to.emit(ctx.recordAccess, "AccessRevoked");
  });

  it("verifies revoked access is denied", async function () {
    const ctx = await loadFixture(fixture);
    await ctx.recordAccess.connect(ctx.patient).grantAccess("P100245", ctx.doctor.address, 0);
    await ctx.recordAccess.connect(ctx.patient).revokeAccess("P100245", ctx.doctor.address);
    expect(await ctx.recordAccess.hasAccess("P100245", ctx.doctor.address)).to.equal(false);
  });

  it("supports time-limited access", async function () {
    const ctx = await loadFixture(fixture);
    const expiresAt = (await time.latest()) + 7 * 24 * 60 * 60;
    await ctx.recordAccess.connect(ctx.patient).grantAccess("P100245", ctx.doctor.address, expiresAt);
    expect(await ctx.recordAccess.hasAccess("P100245", ctx.doctor.address)).to.equal(true);
    expect(await ctx.recordAccess.getAccessExpiry("P100245", ctx.doctor.address)).to.equal(expiresAt);
  });

  it("rejects expired access", async function () {
    const ctx = await loadFixture(fixture);
    const expiresAt = (await time.latest()) + 60;
    await ctx.recordAccess.connect(ctx.patient).grantAccess("P100245", ctx.doctor.address, expiresAt);
    await time.increase(120);
    expect(await ctx.recordAccess.hasAccess("P100245", ctx.doctor.address)).to.equal(false);
    await expect(ctx.recordAccess.expireAccess("P100245", ctx.doctor.address))
      .to.emit(ctx.recordAccess, "AccessExpired");
  });

  it("rejects unauthorized grants", async function () {
    const ctx = await loadFixture(fixture);
    await expect(
      ctx.recordAccess.connect(ctx.doctor).grantAccess("P100245", ctx.doctor.address, 0)
    ).to.be.revertedWithCustomError(ctx.recordAccess, "Unauthorized");
    await expect(
      ctx.recordAccess.connect(ctx.stranger).grantAccess("P100245", ctx.stranger.address, 0)
    ).to.be.revertedWithCustomError(ctx.recordAccess, "Unauthorized");
  });

  it("rejects unauthorized revocation", async function () {
    const ctx = await loadFixture(fixture);
    await ctx.recordAccess.connect(ctx.patient).grantAccess("P100245", ctx.doctor.address, 0);
    await expect(
      ctx.recordAccess.connect(ctx.doctor).revokeAccess("P100245", ctx.doctor.address)
    ).to.be.revertedWithCustomError(ctx.recordAccess, "Unauthorized");
    await expect(
      ctx.recordAccess.connect(ctx.stranger).revokeAccess("P100245", ctx.doctor.address)
    ).to.be.revertedWithCustomError(ctx.recordAccess, "Unauthorized");
  });

  it("rejects invalid expiry timestamps", async function () {
    const ctx = await loadFixture(fixture);
    const past = (await time.latest()) - 1;
    await expect(
      ctx.recordAccess.connect(ctx.patient).grantAccess("P100245", ctx.doctor.address, past)
    ).to.be.revertedWithCustomError(ctx.recordAccess, "InvalidExpiry");
  });
});
