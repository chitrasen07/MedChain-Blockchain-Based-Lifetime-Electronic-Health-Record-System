import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SEPOLIA_MEDICAL_RECORDS, anchorCalldata, previewAnchorTransaction, sendPreparedTransaction } from "../src/lib/consentChain.js";

const patientRef = `0x${"ab".repeat(32)}`;
const doctor = "0xf7d8e63eb6d81c4faded4fdda7edb10d28b54bb0";
const data = anchorCalldata({ versionIndex: 0, recordRef: patientRef, patientRef, contentHash: `0x${"cd".repeat(32)}` });

function wallet(handlers) {
  return {
    async request(args) {
      return handlers(args);
    },
  };
}

describe("anchor preflight", () => {
  it("does not send a transaction when simulation fails", async () => {
    const calls = [];
    await assert.rejects(() => previewAnchorTransaction({
      chainId: 11155111,
      contractAddress: SEPOLIA_MEDICAL_RECORDS,
      data,
      from: doctor,
      ethereum: wallet(({ method }) => {
        calls.push(method);
        if (method === "eth_chainId") return "0xaa36a7";
        if (method === "eth_requestAccounts") return [doctor];
        if (method === "eth_call") throw { data: "0x82b42900" };
        if (method === "eth_sendTransaction") throw new Error("sent");
        throw new Error(method);
      }),
    }), /Doctor role and patient consent/);
    assert.equal(calls.includes("eth_sendTransaction"), false);
  });

  it("refuses the wrong network and the wrong wallet before a transaction", async () => {
    await assert.rejects(() => previewAnchorTransaction({
      chainId: 1,
      contractAddress: SEPOLIA_MEDICAL_RECORDS,
      data,
      from: doctor,
      ethereum: wallet(() => { throw new Error("sent"); }),
    }), /Sepolia/);
    await assert.rejects(() => previewAnchorTransaction({
      chainId: 11155111,
      contractAddress: SEPOLIA_MEDICAL_RECORDS,
      data,
      from: doctor,
      ethereum: wallet(({ method }) => {
        if (method === "eth_chainId") return "0xaa36a7";
        if (method === "eth_requestAccounts") return ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8"];
        throw new Error("sent");
      }),
    }), /consented clinical wallet/);
  });

  it("opens the wallet only after a successful simulation and records rejection", async () => {
    const calls = [];
    const sender = await previewAnchorTransaction({
      chainId: 11155111,
      contractAddress: SEPOLIA_MEDICAL_RECORDS,
      data,
      from: doctor,
      ethereum: wallet(({ method }) => {
        calls.push(method);
        if (method === "eth_chainId") return "0xaa36a7";
        if (method === "eth_requestAccounts") return [doctor];
        if (method === "eth_call") return "0x";
        throw new Error(method);
      }),
    });
    assert.equal(sender, doctor);
    await assert.rejects(() => sendPreparedTransaction({
      chainId: 11155111,
      contractAddress: SEPOLIA_MEDICAL_RECORDS,
      data,
      from: doctor,
      ethereum: wallet(({ method }) => {
        calls.push(method);
        if (method === "eth_chainId") return "0xaa36a7";
        if (method === "eth_requestAccounts") return [doctor];
        if (method === "eth_sendTransaction") throw Object.assign(new Error("rejected"), { code: 4001 });
        throw new Error(method);
      }),
    }), (error) => error.code === 4001);
    assert.equal(calls.filter((method) => method === "eth_sendTransaction").length, 1);
  });
});
