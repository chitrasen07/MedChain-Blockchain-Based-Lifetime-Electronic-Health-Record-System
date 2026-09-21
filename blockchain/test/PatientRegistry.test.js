const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deploySystem, registerSamplePatient } = require("./helpers");

describe("PatientRegistry", function () {
  async function fixture() {
    return deploySystem();
  }

  it("registers a patient and returns identity references only", async function () {
    const ctx = await loadFixture(fixture);
    const patientId = "P100245";

    await expect(
      ctx.patientRegistry
        .connect(ctx.hospitalAdmin)
        .registerPatient(patientId, "did:medchain:abc123", ctx.patient.address)
    ).to.emit(ctx.patientRegistry, "PatientRegistered");

    expect(await ctx.patientRegistry.patientExists(patientId)).to.equal(true);
    const result = await ctx.patientRegistry.getPatient(patientId);
    expect(result.id).to.equal(patientId);
    expect(result.did).to.equal("did:medchain:abc123");
    expect(result.controller).to.equal(ctx.patient.address);
    expect(result.active).to.equal(true);
    expect(result.registeredAt).to.be.gt(0);
  });

  it("rejects duplicate patient IDs", async function () {
    const ctx = await loadFixture(fixture);
    await registerSamplePatient(ctx);
    await expect(
      ctx.patientRegistry
        .connect(ctx.hospitalAdmin)
        .registerPatient("P100245", "did:medchain:other", ctx.extra.address)
    ).to.be.revertedWithCustomError(ctx.patientRegistry, "PatientAlreadyExists");
  });

  it("rejects unauthorized registration", async function () {
    const ctx = await loadFixture(fixture);
    await expect(
      ctx.patientRegistry
        .connect(ctx.doctor)
        .registerPatient("P100245", "did:medchain:abc123", ctx.patient.address)
    ).to.be.revertedWithCustomError(ctx.patientRegistry, "Unauthorized");
    await expect(
      ctx.patientRegistry
        .connect(ctx.stranger)
        .registerPatient("P100245", "did:medchain:abc123", ctx.patient.address)
    ).to.be.revertedWithCustomError(ctx.patientRegistry, "Unauthorized");
  });

  it("looks up a registered patient", async function () {
    const ctx = await loadFixture(fixture);
    await registerSamplePatient(ctx, "P200001");
    expect(await ctx.patientRegistry.patientExists("P200001")).to.equal(true);
    expect(await ctx.patientRegistry.patientExists("P999999")).to.equal(false);
    expect(await ctx.patientRegistry.getController("P200001")).to.equal(ctx.patient.address);
  });

  it("deactivates a patient when authorized", async function () {
    const ctx = await loadFixture(fixture);
    await registerSamplePatient(ctx);

    await expect(ctx.patientRegistry.connect(ctx.hospitalAdmin).deactivatePatient("P100245"))
      .to.emit(ctx.patientRegistry, "PatientDeactivated");

    const result = await ctx.patientRegistry.getPatient("P100245");
    expect(result.active).to.equal(false);
  });

  it("rejects unauthorized deactivation", async function () {
    const ctx = await loadFixture(fixture);
    await registerSamplePatient(ctx);
    await expect(
      ctx.patientRegistry.connect(ctx.stranger).deactivatePatient("P100245")
    ).to.be.revertedWithCustomError(ctx.patientRegistry, "Unauthorized");
  });
});
