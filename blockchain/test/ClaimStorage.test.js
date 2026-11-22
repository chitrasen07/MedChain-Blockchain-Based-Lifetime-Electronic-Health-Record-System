const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deploySystem, claimCommitment, sealedClaim } = require("./helpers");
const { patientSlots, claimAnnouncementFromStorage } = require("../../backend/src/claimState");

describe("claim storage", function () {
  it("reads the announced claimant and timestamp from the deployed layout", async function () {
    const ctx = await deploySystem();
    const patientRef = ethers.hexlify(ethers.randomBytes(32));
    const secret = ethers.hexlify(ethers.randomBytes(32));
    const identity = ethers.hexlify(ethers.randomBytes(32));
    const commitment = claimCommitment(secret);
    const sealed = sealedClaim(ctx.patient.address, secret, patientRef);
    await ctx.patientRegistry.connect(ctx.hospitalAdmin).registerPatient(
      patientRef,
      ethers.ZeroAddress,
      identity,
      commitment
    );
    const tx = await ctx.patientRegistry.connect(ctx.patient).announceControllerClaim(patientRef, sealed);
    const receipt = await tx.wait();
    const block = await ethers.provider.getBlock(receipt.blockNumber);
    const slots = patientSlots(patientRef);
    const registry = await ctx.patientRegistry.getAddress();
    const announcement = claimAnnouncementFromStorage({
      claimantWord: await ethers.provider.getStorage(registry, slots.claimant),
      pendingHashWord: await ethers.provider.getStorage(registry, slots.pendingHash),
      packedWord: await ethers.provider.getStorage(registry, slots.packed)
    });
    expect(announcement.announced).to.equal(true);
    expect(announcement.claimant).to.equal(ctx.patient.address);
    expect(announcement.announcedAt).to.equal(block.timestamp);
    expect(announcement.pendingClaimHash).to.equal(sealed);
    expect(await ethers.provider.getStorage(registry, slots.identity)).to.equal(identity);
    expect(await ethers.provider.getStorage(registry, slots.claim)).to.equal(commitment);
    expect(await ctx.patientRegistry.CLAIM_DELAY()).to.equal(3600);
    expect(await ctx.patientRegistry.CLAIM_WINDOW()).to.equal(86400);
  });
});
