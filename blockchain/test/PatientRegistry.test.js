const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deploySystem, registerSamplePatient, commitmentFor } = require("./helpers");

describe("PatientRegistry", function () {
  async function fixture() {
    return deploySystem();
  }

  it("registers opaque references instead of sequential identifiers", async function () {
    const ctx = await loadFixture(fixture);
    const first = await registerSamplePatient(ctx);
    const second = await registerSamplePatient(ctx);

    expect(first).to.match(/^0x[0-9a-f]{64}$/);
    expect(second).to.not.equal(first);
    expect(first).to.not.match(/PATIENT-/);
    expect(ctx.patientRegistry.interface.fragments.map((item) => item.name)).to.not.include("nextPatientNumber");
  });

  it("stores a controller without a public personal identifier", async function () {
    const ctx = await loadFixture(fixture);
    const patientRef = await registerSamplePatient(ctx);
    const result = await ctx.patientRegistry.getPatient(patientRef);

    expect(result.controller).to.equal(ctx.patient.address);
    expect(result.active).to.equal(true);
    expect(result.registeredAt).to.be.gt(0);
    expect(result).to.not.have.property("did");
  });

  it("rejects registration by unauthorized users", async function () {
    const ctx = await loadFixture(fixture);
    const patientRef = ethers.hexlify(ethers.randomBytes(32));

    await expect(
      ctx.patientRegistry.connect(ctx.doctor).registerPatient(
        patientRef,
        ctx.patient.address,
        commitmentFor(patientRef, "identity"),
        ethers.ZeroHash
      )
    ).to.be.revertedWithCustomError(ctx.patientRegistry, "Unauthorized");
  });

  it("rejects a registration without an identity commitment", async function () {
    const ctx = await loadFixture(fixture);
    const patientRef = ethers.hexlify(ethers.randomBytes(32));

    await expect(
      ctx.patientRegistry.connect(ctx.hospitalAdmin).registerPatient(
        patientRef,
        ctx.patient.address,
        ethers.ZeroHash,
        ethers.ZeroHash
      )
    ).to.be.revertedWithCustomError(ctx.patientRegistry, "InvalidIdentifier");
    expect(ctx.patientRegistry.interface.fragments.map((item) => item.name)).to.not.include(
      "registerPatientWithIdentityCommitment"
    );
  });

  it("binds a commitment to one opaque patient reference", async function () {
    const ctx = await loadFixture(fixture);
    const patientRef = ethers.hexlify(ethers.randomBytes(32));
    const identityCommitment = commitmentFor(patientRef, "identity");
    await ctx.patientRegistry.connect(ctx.hospitalAdmin).registerPatient(
      patientRef,
      ctx.patient.address,
      identityCommitment,
      ethers.ZeroHash
    );

    expect(await ctx.patientRegistry.identityCommitmentExists(identityCommitment)).to.equal(true);
    expect(await ctx.patientRegistry.patientForCommitment(identityCommitment)).to.equal(patientRef);
    await expect(
      ctx.patientRegistry.connect(ctx.hospitalAdmin).registerPatient(
        ethers.hexlify(ethers.randomBytes(32)),
        ctx.extra.address,
        identityCommitment,
        ethers.ZeroHash
      )
    ).to.be.revertedWithCustomError(ctx.patientRegistry, "IdentityCommitmentAlreadyExists");
  });

  it("deactivates a patient when authorized", async function () {
    const ctx = await loadFixture(fixture);
    const patientRef = await registerSamplePatient(ctx);

    await expect(ctx.patientRegistry.connect(ctx.hospitalAdmin).deactivatePatient(patientRef))
      .to.emit(ctx.patientRegistry, "PatientDeactivated");
    expect((await ctx.patientRegistry.getPatient(patientRef)).active).to.equal(false);
  });

  it("rejects unauthorized or repeated deactivation", async function () {
    const ctx = await loadFixture(fixture);
    const patientRef = await registerSamplePatient(ctx);

    await expect(ctx.patientRegistry.connect(ctx.stranger).deactivatePatient(patientRef))
      .to.be.revertedWithCustomError(ctx.patientRegistry, "Unauthorized");
    await ctx.patientRegistry.connect(ctx.hospitalAdmin).deactivatePatient(patientRef);
    await expect(ctx.patientRegistry.connect(ctx.hospitalAdmin).deactivatePatient(patientRef))
      .to.be.revertedWithCustomError(ctx.patientRegistry, "PatientInactive");
  });

  it("rejects both a controller and a claim commitment", async function () {
    const ctx = await loadFixture(fixture);
    const patientRef = ethers.hexlify(ethers.randomBytes(32));

    await expect(
      ctx.patientRegistry.connect(ctx.hospitalAdmin).registerPatient(
        patientRef,
        ctx.patient.address,
        commitmentFor(patientRef, "identity"),
        ethers.hexlify(ethers.randomBytes(32))
      )
    ).to.be.revertedWithCustomError(ctx.patientRegistry, "InvalidOwnership");
  });
});
