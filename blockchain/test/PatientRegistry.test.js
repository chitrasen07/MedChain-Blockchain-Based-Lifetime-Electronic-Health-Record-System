
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deploySystem, registerSamplePatient } = require("./helpers");

describe("PatientRegistry", function () {
  async function fixture() {
    return deploySystem();
  }

  it("generates sequential patient IDs automatically", async function () {
    const ctx = await loadFixture(fixture);

    const firstId = await registerSamplePatient(ctx);
    const secondId = await registerSamplePatient(ctx);
    const thirdId = await registerSamplePatient(ctx);

    expect(firstId).to.equal("PATIENT-000001");
    expect(secondId).to.equal("PATIENT-000002");
    expect(thirdId).to.equal("PATIENT-000003");
  });

  it("registers a patient and stores their identity references", async function () {
    const ctx = await loadFixture(fixture);
    const patientId = await registerSamplePatient(ctx);

    await expect(ctx.patientRegistry.patientExists(patientId))
      .to.eventually.equal(true);

    const result = await ctx.patientRegistry.getPatient(patientId);

    expect(result.id).to.equal(patientId);
    expect(result.did).to.match(/^did:medchain:0x[0-9a-f]{64}$/);
    expect(result.controller).to.equal(ctx.patient.address);
    expect(result.active).to.equal(true);
    expect(result.registeredAt).to.be.gt(0);
  });

  it("generates unique DIDs", async function () {
    const ctx = await loadFixture(fixture);

    const firstId = await registerSamplePatient(ctx);
    const secondId = await registerSamplePatient(ctx);
    const first = await ctx.patientRegistry.getPatient(firstId);
    const second = await ctx.patientRegistry.getPatient(secondId);

    expect(first.did).to.not.equal(second.did);
  });

  it("rejects registration by unauthorized users", async function () {
    const ctx = await loadFixture(fixture);

    await expect(
      ctx.patientRegistry
        .connect(ctx.doctor)
        .registerPatient(ctx.patient.address)
    ).to.be.revertedWithCustomError(ctx.patientRegistry, "Unauthorized");

    await expect(
      ctx.patientRegistry
        .connect(ctx.stranger)
        .registerPatient(ctx.patient.address)
    ).to.be.revertedWithCustomError(ctx.patientRegistry, "Unauthorized");
  });

  it("looks up a registered patient by generated ID", async function () {
    const ctx = await loadFixture(fixture);
    const patientId = await registerSamplePatient(ctx);

    expect(await ctx.patientRegistry.patientExists(patientId)).to.equal(true);
    expect(await ctx.patientRegistry.patientExists("PATIENT-999999")).to.equal(false);
    expect(await ctx.patientRegistry.getController(patientId)).to.equal(
      ctx.patient.address
    );
  });

  it("deactivates a patient when authorized", async function () {
    const ctx = await loadFixture(fixture);
    const patientId = await registerSamplePatient(ctx);

    await expect(
      ctx.patientRegistry
        .connect(ctx.hospitalAdmin)
        .deactivatePatient(patientId)
    ).to.emit(ctx.patientRegistry, "PatientDeactivated");

    const result = await ctx.patientRegistry.getPatient(patientId);
    expect(result.active).to.equal(false);
  });

  it("rejects unauthorized deactivation", async function () {
    const ctx = await loadFixture(fixture);
    const patientId = await registerSamplePatient(ctx);

    await expect(
      ctx.patientRegistry
        .connect(ctx.stranger)
        .deactivatePatient(patientId)
    ).to.be.revertedWithCustomError(ctx.patientRegistry, "Unauthorized");
  });

  it("rejects deactivation of an already inactive patient", async function () {
    const ctx = await loadFixture(fixture);
    const patientId = await registerSamplePatient(ctx);

    await ctx.patientRegistry
      .connect(ctx.hospitalAdmin)
      .deactivatePatient(patientId);

    await expect(
      ctx.patientRegistry
        .connect(ctx.hospitalAdmin)
        .deactivatePatient(patientId)
    ).to.be.revertedWithCustomError(ctx.patientRegistry, "PatientInactive");
  });

  it("rejects zero controllers", async function () {
    const ctx = await loadFixture(fixture);

    await expect(
      ctx.patientRegistry.connect(ctx.hospitalAdmin).registerPatient(ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(ctx.patientRegistry, "ZeroAddress");

    expect(await ctx.patientRegistry.nextPatientNumber()).to.equal(1);
    expect(await registerSamplePatient(ctx)).to.equal("PATIENT-000001");
  });

  it("rejects duplicate identity commitments", async function () {
    const ctx = await loadFixture(fixture);
    const commitment = ethers.keccak256(ethers.toUtf8Bytes("mock identity service commitment"));

    await ctx.patientRegistry
      .connect(ctx.hospitalAdmin)
      .registerPatientWithIdentityCommitment(ctx.patient.address, commitment);

    expect(await ctx.patientRegistry.identityCommitmentExists(commitment)).to.equal(true);
    await expect(
      ctx.patientRegistry
        .connect(ctx.hospitalAdmin)
        .registerPatientWithIdentityCommitment(ctx.extra.address, commitment)
    ).to.be.revertedWithCustomError(ctx.patientRegistry, "IdentityCommitmentAlreadyExists");
  });
});
