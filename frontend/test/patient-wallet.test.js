import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ensurePatientSepolia } from "../src/lib/patientWallet.js";

const originalWindow = globalThis.window;

afterEach(() => {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
});

describe("patient wallet registration", () => {
  it("keeps a Sepolia wallet in place and does not send a transaction", async () => {
    const calls = [];
    globalThis.window = {
      ethereum: {
        request({ method }) {
          calls.push(method);
          if (method === "eth_chainId") return "0xaa36a7";
          throw new Error("unexpected request");
        },
      },
    };
    await ensurePatientSepolia();
    assert.deepEqual(calls, ["eth_chainId"]);
  });

  it("switches to Sepolia without a contract transaction", async () => {
    const calls = [];
    let chain = "0x1";
    globalThis.window = {
      ethereum: {
        async request({ method, params }) {
          calls.push(method);
          if (method === "eth_chainId") return chain;
          if (method === "wallet_switchEthereumChain") {
            assert.equal(params[0].chainId, "0xaa36a7");
            chain = "0xaa36a7";
            return null;
          }
          throw new Error("unexpected request");
        },
      },
    };
    await ensurePatientSepolia();
    assert.deepEqual(calls, ["eth_chainId", "wallet_switchEthereumChain", "eth_chainId"]);
  });

  it("stops when Sepolia cannot be selected", async () => {
    globalThis.window = {
      ethereum: {
        request({ method }) {
          if (method === "eth_chainId") return "0x1";
          throw Object.assign(new Error("missing"), { code: 4902 });
        },
      },
    };
    await assert.rejects(ensurePatientSepolia(), /Add the Sepolia network/);
  });
});
