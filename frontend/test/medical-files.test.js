import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MEDICAL_FILE_LIMIT, medicalFileProblem } from "../src/lib/medicalFiles.js";

describe("medical file selection", () => {
  it("rejects the wrong type and an oversized file", () => {
    assert.equal(medicalFileProblem({ name: "xray.PNG", size: 1024 }), "");
    assert.equal(medicalFileProblem({ name: "report.pdf", size: 1024 }), "");
    assert.equal(medicalFileProblem({ name: "scan.jpeg", size: MEDICAL_FILE_LIMIT }), "");
    assert.equal(medicalFileProblem({ name: "notes.txt", size: 20 }), "This file type is not accepted. Use a PDF, JPG, or PNG.");
    assert.equal(medicalFileProblem({ name: "film.png", size: MEDICAL_FILE_LIMIT + 1 }), "This file is larger than 10 MB.");
  });
});
