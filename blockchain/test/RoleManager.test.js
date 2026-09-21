const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deploySystem } = require("./helpers");

describe("RoleManager", function () {
  async function fixture() {
    return deploySystem();
  }

  it("assigns a role", async function () {
    const ctx = await loadFixture(fixture);
    const pharmacistRole = await ctx.roleManager.PHARMACIST_ROLE();

    await expect(ctx.roleManager.connect(ctx.hospitalAdmin).assignRole(pharmacistRole, ctx.extra.address))
      .to.emit(ctx.roleManager, "RoleAssigned")
      .withArgs(pharmacistRole, ctx.extra.address, ctx.hospitalAdmin.address);

    expect(await ctx.roleManager.hasRole(pharmacistRole, ctx.extra.address)).to.equal(true);
  });

  it("revokes a role", async function () {
    const ctx = await loadFixture(fixture);
    const doctorRole = await ctx.roleManager.DOCTOR_ROLE();
    expect(await ctx.roleManager.hasRole(doctorRole, ctx.doctor.address)).to.equal(true);

    await expect(ctx.roleManager.connect(ctx.hospitalAdmin).revokeRole(doctorRole, ctx.doctor.address))
      .to.emit(ctx.roleManager, "RoleRevoked")
      .withArgs(doctorRole, ctx.doctor.address, ctx.hospitalAdmin.address);

    expect(await ctx.roleManager.hasRole(doctorRole, ctx.doctor.address)).to.equal(false);
  });

  it("rejects unauthorized role assignment", async function () {
    const ctx = await loadFixture(fixture);
    const doctorRole = await ctx.roleManager.DOCTOR_ROLE();
    await expect(
      ctx.roleManager.connect(ctx.stranger).assignRole(doctorRole, ctx.stranger.address)
    ).to.be.revertedWithCustomError(ctx.roleManager, "Unauthorized");
    await expect(
      ctx.roleManager.connect(ctx.hospitalAdmin).assignRole(await ctx.roleManager.SUPER_ADMIN_ROLE(), ctx.stranger.address)
    ).to.be.revertedWithCustomError(ctx.roleManager, "Unauthorized");
  });

  it("verifies assigned roles", async function () {
    const ctx = await loadFixture(fixture);
    expect(await ctx.roleManager.hasRole(await ctx.roleManager.DOCTOR_ROLE(), ctx.doctor.address)).to.equal(true);
    expect(await ctx.roleManager.hasRole(await ctx.roleManager.NURSE_ROLE(), ctx.nurse.address)).to.equal(true);
    expect(await ctx.roleManager.isMedicalStaff(ctx.doctor.address)).to.equal(true);
    expect(await ctx.roleManager.isMedicalStaff(ctx.stranger.address)).to.equal(false);
    expect(await ctx.roleManager.isHospitalAdmin(ctx.hospitalAdmin.address)).to.equal(true);
  });
});
