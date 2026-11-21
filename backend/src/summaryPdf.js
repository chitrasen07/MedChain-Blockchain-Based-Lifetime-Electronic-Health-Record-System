function pdfEscape(value) {
  return String(value ?? "")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function linesFor(chart) {
  const summary = chart.summary || {};
  const list = (items) => items && items.length ? items.join(", ") : "Not recorded";
  const rows = [
    "MedChain medical summary",
    `Patient ID: ${summary.patientId || "Not recorded"}`,
    `Name: ${summary.fullName || "Not recorded"}`,
    `Age: ${Number.isInteger(summary.age) ? String(summary.age) : "Not recorded"}`,
    `Date of birth: ${summary.dateOfBirth || "Not recorded"}`,
    `Gender: ${summary.gender || "Not recorded"}`,
    `Blood group: ${summary.bloodGroup || "Not recorded"}`,
    `DID: ${summary.did || "Not recorded"}`,
    `Allergies: ${list(summary.allergies)}`,
    `Chronic conditions: ${list(summary.chronicConditions)}`,
    `Current diseases: ${list(summary.currentDiseases)}`,
    `Latest diagnosis: ${summary.latestDiagnosis || "Not recorded"}`,
    `Current medications: ${list(summary.currentMedications)}`,
    `Past diseases: ${list(summary.pastDiseases)}`,
    `Surgeries: ${list(summary.surgeries)}`,
    `Treatments: ${list(summary.treatments)}`,
    `Last visit: ${summary.lastVisit || "Not recorded"}`,
    `Latest update: ${summary.latestUpdate ? `${summary.latestUpdate.recordedOn} ${summary.latestUpdate.summary}` : "Not recorded"}`
  ];
  for (const item of chart.prescriptions?.active || []) {
    rows.push(`Active prescription: ${item.medication}; ${item.dosage}; ${item.frequency}; ${item.route}`);
  }
  for (const item of chart.prescriptions?.historical || []) {
    rows.push(`Historical prescription: ${item.medication}; ended ${item.endDate}`);
  }
  for (const series of chart.vitals || []) {
    for (const point of series.points) rows.push(`Vital ${series.label}: ${point.value} ${point.unit} on ${point.recordedOn}`);
  }
  for (const result of chart.labs?.results || []) {
    rows.push(`Lab ${result.testName}: ${result.result} ${result.unit}; range ${result.referenceRange}; collected ${result.collectedOn}`);
  }
  for (const visit of chart.visits || []) rows.push(`Visit ${visit.recordedOn}: ${visit.reason}`);
  for (const record of chart.blockchain || []) {
    rows.push(`Record ${record.category} v${record.version}: ${record.storage}; ${record.anchorStatus}; ${record.contentHash}`);
  }
  rows.push("Clinical decisions remain with the treating clinician. This summary does not diagnose or prescribe.");
  return rows;
}

function pageStream(lines) {
  const commands = ["BT", "/F1 11 Tf", "50 760 Td", "14 TL"];
  lines.forEach((line, index) => {
    if (index) commands.push("T*");
    commands.push(`(${pdfEscape(line).slice(0, 140)}) Tj`);
  });
  commands.push("ET");
  return commands.join("\n");
}

function renderSummaryPdf(chart) {
  const all = linesFor(chart);
  const pages = [];
  for (let index = 0; index < all.length; index += 42) pages.push(all.slice(index, index + 42));
  if (!pages.length) pages.push(["MedChain medical summary", "Not recorded"]);
  const objects = [];
  const pageIds = pages.map((_, index) => 3 + index * 2);
  objects.push("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj");
  objects.push(`2 0 obj << /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >> endobj`);
  pages.forEach((lines, index) => {
    const pageId = pageIds[index];
    const streamId = pageId + 1;
    const stream = pageStream(lines);
    objects.push(`${pageId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${streamId} 0 R /Resources << /Font << /F1 ${3 + pages.length * 2} 0 R >> >> >> endobj`);
    objects.push(`${streamId} 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream endobj`);
  });
  const fontId = 3 + pages.length * 2;
  objects.push(`${fontId} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`);
  let offset = Buffer.byteLength("%PDF-1.4\n");
  const xref = [0];
  const body = objects.map((object) => {
    xref.push(offset);
    const chunk = `${object}\n`;
    offset += Buffer.byteLength(chunk);
    return chunk;
  }).join("");
  const xrefOffset = offset;
  let xrefTable = `xref\n0 ${xref.length}\n`;
  xref.forEach((position, index) => {
    xrefTable += index === 0 ? "0000000000 65535 f \n" : `${String(position).padStart(10, "0")} 00000 n \n`;
  });
  const trailer = `${xrefTable}trailer << /Size ${xref.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(`%PDF-1.4\n${body}${trailer}`);
}

module.exports = { renderSummaryPdf, linesFor };
