const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deploySystem, claimCommitment } = require("./helpers");

const DOMAIN = { name: "MedChain Patient Registry", version: "2" };
const TYPES = {
  ClaimController: [
    { name: "patientRef", type: "bytes32" },
    { name: "claimCommitment", type: "bytes32" }
  ]
};

async function deployV2(ctx) {
  const registry = await ethers.deployContract("PatientRegistryV2", [
    await ctx.roleManager.getAddress(),
    await ctx.auditLog.getAddress()
  ]);
  await ctx.auditLog.setAuthorizedLogger(await registry.getAddress(), true);
  const access = await ethers.deployContract("RecordAccessControl", [
    await ctx.roleManager.getAddress(),
    await registry.getAddress(),
    await ctx.auditLog.getAddress()
  ]);
  await ctx.auditLog.setAuthorizedLogger(await access.getAddress(), true);
  return { registry, access };
}

async function registerUnclaimed(registry, admin, secret) {
  const patientRef = ethers.hexlify(ethers.randomBytes(32));
  const identity = ethers.hexlify(ethers.randomBytes(32));
  const commitment = claimCommitment(secret);
  await registry.connect(admin).registerPatient(patientRef, ethers.ZeroAddress, identity, commitment);
  return { patientRef, commitment };
}

async function claimNow(registry, signer, patientRef, secret, commitment) {
  const signature = await signer.signTypedData(
    { ...DOMAIN, chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await registry.getAddress() },
    TYPES,
    { patientRef, claimCommitment: commitment }
  );
  await registry.connect(signer).claimController(patientRef, secret, signature);
}

describe("instant wallet claim", function () {
  it("links a new unclaimed patient immediately and preserves an older owned patient", async function () {
    const ctx = await deploySystem();
    const { registry, access } = await deployV2(ctx);
    const secret = ethers.hexlify(ethers.randomBytes(32));
    const opened = await registerUnclaimed(registry, ctx.hospitalAdmin, secret);
    const ownedRef = ethers.hexlify(ethers.randomBytes(32));
    await ctx.patientRegistry.connect(ctx.hospitalAdmin).registerPatient(
      ownedRef,
      ctx.patient.address,
      ethers.hexlify(ethers.randomBytes(32)),
      ethers.ZeroHash
    );

    await claimNow(registry, ctx.stranger, opened.patientRef, secret, opened.commitment);
    expect(await registry.getController(opened.patientRef)).to.equal(ctx.stranger.address);
    expect(await ctx.patientRegistry.getController(ownedRef)).to.equal(ctx.patient.address);

    await access.connect(ctx.stranger).grantAccess(opened.patientRef, ctx.doctor.address, 0);
    expect(await access.hasAccess(opened.patientRef, ctx.doctor.address)).to.equal(true);
    expect(await ctx.recordAccess.hasAccess(ownedRef, ctx.doctor.address)).to.equal(false);
  });

  it("rejects a wrong secret, a staff wallet, a replay, and a second claim", async function () {
    const ctx = await deploySystem();
    const { registry } = await deployV2(ctx);
    const secret = ethers.hexlify(ethers.randomBytes(32));
    const opened = await registerUnclaimed(registry, ctx.hospitalAdmin, secret);
    const domain = {
      ...DOMAIN,
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await registry.getAddress()
    };
    const signature = await ctx.stranger.signTypedData(domain, TYPES, {
      patientRef: opened.patientRef,
      claimCommitment: opened.commitment
    });

    await expect(
      registry.connect(ctx.stranger).claimController(opened.patientRef, ethers.hexlify(ethers.randomBytes(32)), signature)
    ).to.be.revertedWithCustomError(registry, "InvalidClaim");
    await expect(
      registry.connect(ctx.doctor).claimController(opened.patientRef, secret, signature)
    ).to.be.revertedWithCustomError(registry, "StaffOwner");

    const stolen = await ctx.extra.signTypedData(domain, TYPES, {
      patientRef: opened.patientRef,
      claimCommitment: opened.commitment
    });
    await expect(registry.connect(ctx.extra).claimController(opened.patientRef, secret, stolen)).to.not.be.reverted;
    await expect(
      registry.connect(ctx.extra).claimController(opened.patientRef, secret, stolen)
    ).to.be.revertedWithCustomError(registry, "ControllerAlreadySet");
    expect(await registry.getController(opened.patientRef)).to.equal(ctx.extra.address);
  });

  it("does not let a copied signature claim for a different wallet", async function () {
    const ctx = await deploySystem();
    const { registry } = await deployV2(ctx);
    const secret = ethers.hexlify(ethers.randomBytes(32));
    const opened = await registerUnclaimed(registry, ctx.hospitalAdmin, secret);
    const signature = await ctx.stranger.signTypedData(
      { ...DOMAIN, chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await registry.getAddress() },
      TYPES,
      { patientRef: opened.patientRef, claimCommitment: opened.commitment }
    );
    await expect(
      registry.connect(ctx.extra).claimController(opened.patientRef, secret, signature)
    ).to.be.revertedWithCustomError(registry, "Unauthorized");
    expect(await registry.getController(opened.patientRef)).to.equal(ethers.ZeroAddress);
  });

  it("keeps the original registry delay for a patient who has not moved", async function () {
    const ctx = await deploySystem();
    const secret = ethers.hexlify(ethers.randomBytes(32));
    const patientRef = ethers.hexlify(ethers.randomBytes(32));
    await ctx.patientRegistry.connect(ctx.hospitalAdmin).registerPatient(
      patientRef,
      ethers.ZeroAddress,
      ethers.hexlify(ethers.randomBytes(32)),
      claimCommitment(secret)
    );
    expect(await ctx.patientRegistry.CLAIM_DELAY()).to.equal(3600);
    expect(await ctx.patientRegistry.getController(patientRef)).to.equal(ethers.ZeroAddress);
  });
});
