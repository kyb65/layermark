// validate.js — LayerMark .lmm validator
// Usage: node validate.js <file.lmm>

const fs   = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const Ajv  = require("ajv");

// ── 1. args ───────────────────────────────────────────────────
const targetFile = process.argv[2];
if (!targetFile) { console.error("Usage: node validate.js <file.lmm>"); process.exit(1); }

// ── 2. load schema ────────────────────────────────────────────
const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "lmm.schema.json"), "utf8"));

// ── 3. parse YAML ─────────────────────────────────────────────
let doc;
try {
  doc = yaml.load(fs.readFileSync(targetFile, "utf8"));
} catch (e) {
  console.error(`YAML parse error: ${e.message}`); process.exit(1);
}

// ── 4. JSON Schema validation ─────────────────────────────────
const ajv      = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);
if (!validate(doc)) {
  console.error(`❌  ${targetFile} — schema FAILED`);
  for (const e of validate.errors)
    console.error(`    [${e.instancePath || "/"}] ${e.message}`);
  process.exit(1);
}
console.log(`✅  ${targetFile} — schema OK`);

// ── 5. semantic rules ─────────────────────────────────────────
const errors = [];

// collect all declared IDs
const anchorIds     = new Set(doc.anchors.map(a => a.id));
const annotationIds = new Set(
  doc.annotations.filter(a => a.id).map(a => a.id)
);
const allIds = new Set([...anchorIds, ...annotationIds]);

// Rule A: anchor IDs must be unique
const anchorIdList = doc.anchors.map(a => a.id);
const dupAnchors   = anchorIdList.filter((id, i) => anchorIdList.indexOf(id) !== i);
if (dupAnchors.length) errors.push(`Duplicate anchor IDs: ${[...new Set(dupAnchors)].join(", ")}`);

// Rule B: annotation IDs must be unique (across all annotations)
const annIdList = doc.annotations.filter(a => a.id).map(a => a.id);
const dupAnns   = annIdList.filter((id, i) => annIdList.indexOf(id) !== i);
if (dupAnns.length) errors.push(`Duplicate annotation IDs: ${[...new Set(dupAnns)].join(", ")}`);

// Rule C: all referenced IDs must exist
for (const ann of doc.annotations) {
  const check = (field, val) => {
    if (val !== undefined && !allIds.has(val))
      errors.push(`[${ann.type}] '${field}: ${val}' references unknown ID`);
  };
  check("target",     ann.target);
  check("from",       ann.from);
  check("to",         ann.to);
  check("connection", ann.connection);
}

// Rule D: connection cannot point to itself
for (const ann of doc.annotations) {
  if (ann.type === "connection" && ann.from === ann.to)
    errors.push(`[connection id=${ann.id || "?"}] 'from' and 'to' cannot be the same ID`);
}

// Rule E: note cannot have both 'target' and 'connection'
for (const ann of doc.annotations) {
  if (ann.type === "note" && ann.target && ann.connection)
    errors.push(`[note] cannot have both 'target' and 'connection' — pick one`);
}

// Rule F: highlight must have color
for (const ann of doc.annotations) {
  if (ann.type === "highlight" && !ann.color)
    errors.push(`[highlight] missing required 'color' field`);
}

// Rule G: bracket must have style
for (const ann of doc.annotations) {
  if (ann.type === "bracket" && !ann.style)
    errors.push(`[bracket] missing required 'style' field`);
}

// ── 6. report ─────────────────────────────────────────────────
if (errors.length) {
  console.error(`❌  ${targetFile} — semantic rules FAILED`);
  for (const e of errors) console.error(`    • ${e}`);
  process.exit(1);
}

console.log(`✅  ${targetFile} — semantic rules OK`);
console.log();
console.log("Summary:");
console.log(`  anchors     : ${doc.anchors.length}`);
console.log(`  annotations : ${doc.annotations.length}`);

const byType = {};
for (const a of doc.annotations) byType[a.type] = (byType[a.type] || 0) + 1;
for (const [t, n] of Object.entries(byType))
  console.log(`    ${t.padEnd(12)}: ${n}`);
