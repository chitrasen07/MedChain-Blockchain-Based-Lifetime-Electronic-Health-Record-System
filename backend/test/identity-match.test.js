const test = require("node:test");
const assert = require("node:assert/strict");
const { fieldHash } = require("../src/crypto");
const { decidePatientMatch, identifyingHashes } = require("../src/db");

const secret = Buffer.alloc(32, 7);
const meera = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ravi = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const anika = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function row(id, patientId, field, value) {
  fieldHash(secret, field, value);
  return { id, patient_id: patientId, did: `did:${patientId}`, fieldName: field };
}

test("shared gender or blood group is not a duplicate", () => {
  const rows = [
    row(meera, "PATIENT-000011", "gender", "Female"),
    row(meera, "PATIENT-000011", "bloodGroup", "O+"),
    row(ravi, "PATIENT-000012", "gender", "Female"),
    row(anika, "PATIENT-000013", "bloodGroup", "O+")
  ];
  assert.equal(decidePatientMatch(rows).status, "no_match");
  assert.deepEqual(identifyingHashes([
    ["fullName", "name"],
    ["gender", "female"],
    ["bloodGroup", "o+"],
    ["emergencyContact", "parent"]
  ]), [["fullName", "name"]]);
});

test("several unrelated patients stay clear of review", () => {
  const rows = [
    row(meera, "PATIENT-000011", "dateOfBirth", "1991-04-04"),
    row(ravi, "PATIENT-000012", "dateOfBirth", "1991-04-04"),
    row(anika, "PATIENT-000013", "emergencyContact", "Hospital desk")
  ];
  assert.equal(decidePatientMatch(rows).status, "no_match");
});

test("the same name or phone still requires review", () => {
  const byName = decidePatientMatch([
    row(meera, "PATIENT-000011", "fullName", "Meera Nair"),
    row(meera, "PATIENT-000011", "gender", "Female")
  ]);
  assert.equal(byName.status, "possible_match");
  assert.deepEqual(byName.candidates, [meera]);
  const byPhone = decidePatientMatch([row(ravi, "PATIENT-000012", "mobile", "9000000001")]);
  assert.equal(byPhone.status, "possible_match");
  const byEmail = decidePatientMatch([row(anika, "PATIENT-000013", "email", "anika@example.test")]);
  assert.equal(byEmail.status, "possible_match");
});

test("name, date of birth, and a contact are a same-person match", () => {
  const match = decidePatientMatch([
    row(meera, "PATIENT-000011", "fullName", "Meera Nair"),
    row(meera, "PATIENT-000011", "dateOfBirth", "1991-04-04"),
    row(meera, "PATIENT-000011", "mobile", "9000000001"),
    row(ravi, "PATIENT-000012", "gender", "Female")
  ]);
  assert.equal(match.status, "high_confidence");
  assert.equal(match.patient.patient_id, "PATIENT-000011");
  assert.deepEqual(match.candidates, [meera]);
});

test("two strong overlaps stay in review instead of picking one", () => {
  const match = decidePatientMatch([
    row(meera, "PATIENT-000011", "fullName", "Meera Nair"),
    row(meera, "PATIENT-000011", "dateOfBirth", "1991-04-04"),
    row(meera, "PATIENT-000011", "email", "meera@example.test"),
    row(ravi, "PATIENT-000012", "fullName", "Meera Nair"),
    row(ravi, "PATIENT-000012", "dateOfBirth", "1991-04-04"),
    row(ravi, "PATIENT-000012", "mobile", "9000000001")
  ]);
  assert.equal(match.status, "possible_match");
  assert.equal(match.candidateCount, 2);
});

test("a changed name is not the same identity overlap", () => {
  const original = decidePatientMatch([row(meera, "PATIENT-000011", "fullName", "Meera Nair")]);
  const changed = decidePatientMatch([row(meera, "PATIENT-000011", "fullName", "Anika Shah")]);
  assert.equal(original.status, "possible_match");
  assert.equal(changed.status, "possible_match");
  assert.notEqual(fieldHash(secret, "fullName", "Meera Nair"), fieldHash(secret, "fullName", "Anika Shah"));
  assert.equal(fieldHash(secret, "gender", "Female"), fieldHash(secret, "gender", " female "));
});
