// Copyright (c) 2026 ZEBRA BI informacijske rešitve d.d. Distributed under the terms in LICENSE at the repository root.
"use strict";
/**
 * A structural TMDL reader: every line becomes an object node, a property, or expression body.
 *
 * `tmdl.js` answers three Zebra questions from a flat table/column/measure view. This module is the
 * layer beneath it: a generic tree of every object in a .tmdl document, with each property's name,
 * delimiter, value and line number, plus the schema of what TMDL allows on each object type. The
 * grammar-level rules (unknown property, illegal enum value, duplicate property, duplicate object,
 * a description separated from its object, a missing `database` line, an unresolved relationship
 * endpoint, a feature below the model's compatibility level) all read this tree.
 *
 * The grammar this implements is Microsoft's TMDL specification as MEASURED against Power BI
 * Desktop 2.157 on 2026-09-05, one variant at a time through file.reload/v1:
 *
 *   - Indentation is whitespace depth. Desktop writes tabs; two and four spaces, and a file mixing
 *     them, all load. So depth is measured in columns (tab = 4) and compared, never counted.
 *   - An object is `<type> <name>` optionally `= <default>`; a handful of types take no name
 *     (`database`, `calculationGroup`, `kpi`, `relatedColumnDetails`, `translations`,
 *     `dataAccessOptions`, `refreshPolicy`, `calendarColumnGroup`, `alternateOf`).
 *   - A property is `name: value` (one line) or `name = expression` (one line, or a body on the
 *     following lines indented deeper than the object's properties, or a ``` fenced body).
 *   - A bare identifier alone on a line is a boolean property set to true.
 *   - `///` lines are descriptions bound to the very next line; a blank line between them fails.
 *   - `ref <type> <name>` lines are ordering, and are kept as nodes of type `ref`.
 *   - Names and property keywords are case-insensitive on read. Every comparison here lowercases.
 *
 * Unknown constructs are recorded (type `other`) rather than guessed at, so a rule can decide.
 */

/** Indent width in columns. A tab counts as four, which keeps tab and space files comparable. */
const indentOf = (line) => (line.match(/^[\t ]*/) || [""])[0].replace(/\t/g, "    ").length;

/** Strip TMDL's single-quote name quoting and un-double the escaped quotes inside. */
function unquoteName(s = "") {
  const t = s.trim();
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

/** Object types whose declaration carries no name. */
const UNNAMED = new Set([
  "database", "calculationgroup", "kpi", "relatedcolumndetails", "translations",
  "dataaccessoptions", "refreshpolicy", "calendarcolumngroup", "alternateof",
  "connectiondetails", "address", "credential", "options", "automaticaggregationoptions",
  "linguisticmetadata", "source",
]);

/**
 * Split `<type> <rest>` where rest is a quoted or bare name, optionally followed by `= default`.
 * A bare name may run over several words -- that is the unquoted-space FAULT, and it is kept so
 * the rule that names it can fire on a node rather than on a regex.
 */
const OBJECT_RE = /^([A-Za-z][A-Za-z0-9]*)\s+(.+)$/;
const PROP_RE = /^([A-Za-z][A-Za-z0-9]*)\s*(:|=)\s*(.*)$/;
const BARE_RE = /^([A-Za-z][A-Za-z0-9]*)\s*$/;

function splitNameAndDefault(rest) {
  // name may be quoted: 'a ''b'' c' ; the default starts at the first `=` outside quotes.
  let i = 0, inQ = false;
  for (; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === "'") { inQ = !inQ; continue; }
    if (!inQ && ch === "=") break;
  }
  if (i >= rest.length) return { name: rest.trim(), hasDefault: false, def: "" };
  return { name: rest.slice(0, i).trim(), hasDefault: true, def: rest.slice(i + 1).trim() };
}

/**
 * Parse one document into a tree. Returns { root, nodes, lines } where root.children are the
 * root-level objects, `nodes` is every node in document order, and `lines` is the per-line
 * classification (`kind`: blank | desc | object | prop | body | other, plus `inExpr`).
 */
function parseTree(text) {
  const raw = text.split(/\r?\n/);
  const lines = raw.map((l) => ({ raw: l, ind: indentOf(l), kind: "blank", inExpr: false }));
  const root = { type: "root", name: "", ind: -1, line: 0, props: [], children: [], desc: [] };
  const nodes = [];
  const stack = [root];                        // open objects, innermost last
  let pendingDesc = [];                        // /// lines waiting for their object
  let pendingDescLine = -1;
  let descGapAt = -1;                          // a blank line after a description: a fault
  const faults = [];                           // grammar faults found while parsing

  // Expression body tracking. `owner` is the node or property whose body is being read.
  let body = null;      // { owner, fenced, minInd, startLine }

  const unit = (() => {
    // smallest positive indentation step in the file: the tab (4) in Desktop's files, 2 or 4 in
    // space-indented ones. Used only to decide where an indented expression body ends.
    let m = Infinity;
    for (const l of lines) { const t = l.raw.trim(); if (t && l.ind > 0 && l.ind < m) m = l.ind; }
    return Number.isFinite(m) ? m : 4;
  })();

  const closeBody = (i) => { body = null; };
  // A property-looking line inside an unfenced body: `formatString: #,##0` read as DAX. Runs when
  // the body ends and again at end of file, because a fixture (or a real file) can end inside one.
  const scanBody = (b) => {
    if (!b || b.fenced) return;
    const ownerType = b.owner.kind === "prop" ? (b.owner.owner.type || "") : (b.owner.type || "");
    const sch = SCHEMA[ownerType];
    b.owner.body.forEach((bl, k) => {
      const mp = bl.trim().match(/^([A-Za-z][A-Za-z0-9]*)\s*:/);
      if (mp && sch && sch.props.has(mp[1].toLowerCase())) {
        faults.push({ kind: "property-in-body", line: (b.owner.line || 0) + k + 1, owner: b.owner, property: mp[1] });
      }
    });
  };

  for (let i = 0; i < raw.length; i++) {
    const L = lines[i];
    const t = L.raw.trim();

    // --- inside an expression body -----------------------------------------------------------
    if (body) {
      if (body.fenced) {
        L.kind = "body"; L.inExpr = true;
        if (t === "```") { L.kind = "fence-close"; L.inExpr = false; body.owner.bodyEnd = i; closeBody(i); }
        else body.owner.body.push(L.raw);
        continue;
      }
      if (t === "") { L.kind = "body"; L.inExpr = true; body.owner.body.push(""); continue; }
      // Desktop's rule, measured 2026-09-05: once an unfenced body has opened, it runs while lines
      // stay at or deeper than its FIRST line, and ends at the first non-blank line shallower than
      // that. So a body written at property depth swallows the `formatString:` that follows it --
      // the line becomes DAX and the engine holds the measure in error state 5 ("The syntax for
      // 'formatString' is incorrect"). Desktop's own files put the body one level deeper than the
      // properties, which is why a property line ends theirs.
      const ownerInd = body.owner.kind === "prop" ? body.owner.owner.ind : body.owner.ind;
      if (L.ind > ownerInd && (body.firstInd === undefined || L.ind >= body.firstInd)) {
        if (body.firstInd === undefined) body.firstInd = L.ind;
        L.kind = "body"; L.inExpr = true; body.owner.body.push(L.raw);
        body.owner.bodyFirstInd = body.firstInd;
        continue;
      }
      // The body has ended. If it swallowed a line that reads as a property of its owner, say so:
      // that is the shallow-body fault, and the object it belongs to is now broken DAX.
      scanBody(body);
      // shallower than the body: the body has ended; fall through and read this line normally
      while (body.owner.body.length && body.owner.body[body.owner.body.length - 1] === "") body.owner.body.pop();
      body.owner.bodyEnd = i - 1;
      closeBody(i);
    }

    if (t === "") {
      if (pendingDesc.length && descGapAt < 0) descGapAt = i;
      continue;
    }
    if (t.startsWith("///")) {
      L.kind = "desc";
      if (descGapAt >= 0) { /* a description already interrupted by a blank line; keep collecting */ }
      if (!pendingDesc.length) pendingDescLine = i;
      pendingDesc.push(t.replace(/^\/\/\/\s?/, ""));
      continue;
    }

    // pop the stack to the innermost object that is shallower than this line
    while (stack.length > 1 && stack[stack.length - 1].ind >= L.ind) stack.pop();
    const parent = stack[stack.length - 1];

    const takeDesc = (node) => {
      if (pendingDesc.length) {
        node.desc = pendingDesc.slice(); node.descLine = pendingDescLine;
        if (descGapAt >= 0) faults.push({ kind: "description-gap", line: descGapAt + 1, descLine: pendingDescLine + 1, target: node });
      }
      pendingDesc = []; pendingDescLine = -1; descGapAt = -1;
    };

    // `ref table X`
    if (/^ref\s+/i.test(t)) {
      const m = t.match(/^ref\s+([A-Za-z]+)\s+(.+)$/i);
      const node = { type: "ref", refType: m ? m[1].toLowerCase() : "", name: m ? unquoteName(m[2]) : t,
                     rawName: m ? m[2].trim() : "", ind: L.ind, line: i + 1, props: [], children: [], desc: [], parent };
      L.kind = "object"; parent.children.push(node); nodes.push(node); takeDesc(node);
      continue;
    }

    const mProp = t.match(PROP_RE);
    const mBare = t.match(BARE_RE);
    const mObj = t.match(OBJECT_RE);

    // A property: `name: value`, `name = expr`, or a bare boolean -- but only when the parent is
    // an object (root-level bare words are objects like `database`). `calendarColumnGroup = year`
    // and `changedProperty = X` look like properties and are objects; handled below.
    const firstWord = (mProp && mProp[1]) || (mBare && mBare[1]) || (mObj && mObj[1]) || "";
    const fw = firstWord.toLowerCase();
    const isUnnamedObject = UNNAMED.has(fw) && (mBare || (mProp && mProp[2] === "=" && fw === "calendarcolumngroup"));

    if (parent !== root && !isUnnamedObject && (mProp || mBare) && !(mObj && !mProp && !mBare)) {
      // `changedProperty = X` is an object in TOM; it is read as a property named changedProperty
      // whose value is the property name, which is exactly how a rule wants to see it.
      const name = firstWord;
      const delim = mProp ? mProp[2] : "";
      const value = mProp ? mProp[3].trim() : "";
      const prop = { kind: "prop", name, delim, value, line: i + 1, body: [], multiline: false, fenced: false, owner: parent };
      parent.props.push(prop);
      L.kind = "prop";
      if (pendingDesc.length) { faults.push({ kind: "description-on-property", line: pendingDescLine + 1, prop }); pendingDesc = []; pendingDescLine = -1; descGapAt = -1; }
      if (delim === "=") {
        if (value === "```") { prop.fenced = true; prop.multiline = true; body = { owner: prop, fenced: true }; }
        else if (value === "") { prop.multiline = true; body = { owner: prop, fenced: false, minInd: L.ind + 1 }; }
        else if (value.endsWith("```")) { prop.fenced = true; prop.multiline = true; prop.inline = value.slice(0, -3).trim(); body = { owner: prop, fenced: true }; }
      }
      continue;
    }

    if (mObj || isUnnamedObject) {
      let type = fw, name = "", rawName = "", hasDefault = false, def = "";
      if (isUnnamedObject) {
        if (mProp) { hasDefault = true; def = mProp[3].trim(); }
      } else {
        const sp = splitNameAndDefault(mObj[2]);
        rawName = sp.name; name = unquoteName(sp.name); hasDefault = sp.hasDefault; def = sp.def;
      }
      const node = { type, typeRaw: firstWord, name, rawName, hasDefault, def, ind: L.ind, line: i + 1,
                     props: [], children: [], desc: [], body: [], parent,
                     nameUnquotedWithSpace: Boolean(rawName) && !rawName.startsWith("'") && /\s/.test(rawName) };
      parent.children.push(node); nodes.push(node); stack.push(node);
      L.kind = "object";
      takeDesc(node);
      if (hasDefault) {
        if (def === "```") { node.fenced = true; node.multiline = true; body = { owner: node, fenced: true }; }
        else if (def === "") { node.multiline = true; body = { owner: node, fenced: false, minInd: L.ind + 1 }; }
        else if (def.endsWith("```")) { node.fenced = true; node.multiline = true; node.def = def.slice(0, -3).trim(); body = { owner: node, fenced: true }; }
      }
      continue;
    }

    // Anything else: DAX that escaped its body, a stray token, a `//` comment.
    L.kind = "other";
    if (pendingDesc.length) { pendingDesc = []; pendingDescLine = -1; descGapAt = -1; }
    parent.other = parent.other || [];
    parent.other.push({ line: i + 1, text: t });
  }
  if (body && !body.fenced) { while (body.owner.body.length && body.owner.body[body.owner.body.length - 1] === "") body.owner.body.pop(); scanBody(body); }
  if (body && body.fenced) faults.push({ kind: "unclosed-fence", line: (body.owner.line || 0) });
  if (pendingDesc.length) faults.push({ kind: "dangling-description", line: pendingDescLine + 1 });

  // The multi-line body of an indented (unfenced) expression must sit deeper than the object's
  // properties. The reader above accepts anything deeper than the OBJECT, which is what Desktop
  // does too when it can; the specification's stricter rule is enforced by the rule layer.
  void unit;
  return { root, nodes, lines, faults };
}

/** The expression text of a node or property: inline default plus body, joined. */
function expressionOf(x) {
  const parts = [];
  if (x.def && !x.multiline) parts.push(x.def);
  if (x.inline) parts.push(x.inline);
  if (x.value && !x.multiline && x.delim === "=") parts.push(x.value);
  if (x.body && x.body.length) parts.push(x.body.map((l) => l.trim()).join(" "));
  return parts.join(" ").trim();
}

/** Find one property by name (case-insensitive). */
const prop = (node, name) => node.props.find((p) => p.name.toLowerCase() === name.toLowerCase());
/** Value of a property, or null. */
const propValue = (node, name) => { const p = prop(node, name); return p ? p.value : null; };
/** A boolean property: bare, or `: true`. */
const propBool = (node, name) => { const p = prop(node, name); if (!p) return false; return p.delim === "" || /^true$/i.test(p.value); };
/** Children of one type (case-insensitive). */
const kids = (node, type) => node.children.filter((c) => c.type === type.toLowerCase());

// ---------------------------------------------------------------------------------------------
// The schema: what TMDL accepts on each object type, from the Tabular Object Model reference
// (every TMDL property is the TOM property in camelCase) checked against Desktop 2.157 and a
// corpus of 860 real .tmdl files. Names are stored lowercase; compare lowercase.
//
// `props` are `name: value` / `name = value` / bare boolean lines. `children` are nested object
// types. A property in neither list is what Desktop reports as
//   "The keyword 'x' is neither a property nor an object in the current context!"
// ---------------------------------------------------------------------------------------------
const COMMON_CHILDREN = ["annotation", "extendedproperty"];
const S = (props, children = [], repeatable = []) => ({
  props: new Set(props.map((s) => s.toLowerCase())),
  children: new Set([...COMMON_CHILDREN, ...children].map((s) => s.toLowerCase())),
  repeatable: new Set(repeatable.map((s) => s.toLowerCase())),
});

const SCHEMA = {
  database: S(["compatibilityLevel", "compatibilityMode", "id", "language", "collation", "readWriteMode", "description"], []),
  model: S([
    "culture", "collation", "defaultMode", "defaultDataView", "storageLocation", "description",
    "defaultPowerBIDataSourceVersion", "discourageImplicitMeasures",
    "discourageCompositeModels", "forceUniqueNames", "sourceQueryCulture", "mAttributes",
    "maxParallelismPerRefresh", "maxParallelismPerQuery", "dataSourceDefaultMaxConnections",
    "dataSourceVariablesOverrideBehavior", "directLakeBehavior", "defaultMeasure", "disableAutoExists",
    "valueFilterBehavior", "selectionExpressionBehavior", "metadataAccessPolicy",
  ], ["dataAccessOptions", "automaticAggregationOptions", "table", "relationship", "expression",
      "function", "role", "perspective", "cultureInfo", "culture", "queryGroup", "dataSource", "ref"]),
  dataaccessoptions: S(["legacyRedirects", "returnErrorValuesAsNull", "fastCombine"], []),
  table: S([
    "dataCategory", "isHidden", "isPrivate", "showAsVariationsOnly", "excludeFromModelRefresh",
    "systemManaged", "excludeFromAutomaticAggregations", "lineageTag", "sourceLineageTag",
    "description", "defaultDetailRowsDefinition", "alternateSourcePrecedence",
  ], ["column", "measure", "hierarchy", "partition", "calculationGroup", "refreshPolicy", "calendar",
      "changedProperty", "alternateOf"]),
  column: S([
    "dataType", "dataCategory", "description", "isHidden", "isKey", "isNullable", "isUnique",
    "isDefaultLabel", "isDefaultImage", "isAvailableInMdx", "keepUniqueRows", "isNameInferred",
    "isDataTypeInferred", "sourceColumn", "sortByColumn", "formatString", "displayFolder",
    "displayOrdinal", "summarizeBy", "alignment", "encodingHint", "lineageTag", "sourceLineageTag",
    "sourceProviderType", "tableDetailPosition", "stringIndexingBehavior", "type", "changedProperty",
  ], ["variation", "relatedColumnDetails", "alternateOf", "attributeHierarchy", "changedProperty"]),
  measure: S([
    "formatString", "displayFolder", "isHidden", "isSimpleMeasure", "dataCategory", "dataType",
    "description", "lineageTag", "sourceLineageTag", "formatStringDefinition", "detailRowsDefinition",
    "changedProperty",
  ], ["kpi", "changedProperty"]),
  partition: S(["mode", "dataView", "description", "queryGroup", "source", "expression", "retainDataTillForceCalculate",
                "refreshBookmark", "type"], ["dataCoverageDefinition", "source"]),
  relationship: S(["fromColumn", "toColumn", "isActive", "crossFilteringBehavior", "fromCardinality",
                   "toCardinality", "securityFilteringBehavior", "joinOnDateBehavior",
                   "relyOnReferentialIntegrity", "type", "changedProperty"], ["changedProperty"]),
  hierarchy: S(["isHidden", "displayFolder", "description", "hideMembers", "lineageTag", "sourceLineageTag",
                "changedProperty"], ["level", "changedProperty"]),
  level: S(["column", "ordinal", "description", "lineageTag", "sourceLineageTag", "changedProperty"], ["changedProperty"]),
  calculationgroup: S(["precedence", "description", "multipleOrEmptySelectionExpression", "noSelectionExpression"],
                      ["calculationItem"]),
  calculationitem: S(["ordinal", "description", "formatStringDefinition", "changedProperty"], ["changedProperty"]),
  kpi: S(["targetExpression", "targetDescription", "targetFormatString", "statusExpression", "statusGraphic",
          "statusDescription", "trendExpression", "trendGraphic", "trendDescription", "description"], []),
  role: S(["modelPermission", "description"], ["tablePermission", "member"]),
  tablepermission: S(["metadataPermission", "filterExpression", "description"], ["columnPermission"]),
  columnpermission: S(["metadataPermission", "description"], []),
  member: S(["identityProvider", "memberId", "memberName", "memberType", "description"], []),
  perspective: S(["description"], ["perspectiveTable"]),
  perspectivetable: S(["includeAll", "description"], ["perspectiveColumn", "perspectiveMeasure", "perspectiveHierarchy",
                                                      "perspectiveSet", "perspectiveCalculationGroup"]),
  perspectivecolumn: S(["description"], []),
  perspectivemeasure: S(["description"], []),
  perspectivehierarchy: S(["description"], []),
  expression: S(["kind", "queryGroup", "description", "lineageTag", "sourceLineageTag", "mAttributes",
                 "parameterValuesColumn", "remoteParameterName", "expressionSource"], []),
  function: S(["isHidden", "description", "lineageTag", "sourceLineageTag", "changedProperty"], ["changedProperty"]),
  querygroup: S(["folder", "description"], []),
  refreshpolicy: S(["policyType", "mode", "incrementalGranularity", "incrementalPeriods", "incrementalPeriodsOffset",
                    "rollingWindowGranularity", "rollingWindowPeriods", "sourceExpression", "pollingExpression"], []),
  variation: S(["isDefault", "relationship", "defaultHierarchy", "defaultColumn", "description"], []),
  relatedcolumndetails: S(["groupByColumn"], [], ["groupByColumn"]),
  alternateof: S(["baseTable", "baseColumn", "summarization"], []),
  calendar: S(["description", "lineageTag", "sourceLineageTag"], ["calendarColumnGroup"]),
  calendarcolumngroup: S(["primaryColumn", "associatedColumn", "column"], [], ["associatedColumn", "column"]),
  datacoveragedefinition: S(["description"], []),
  // Cultures: the tree under `translations` mirrors the model (table/column/measure/hierarchy with
  // caption/description/displayFolder), so those nodes are not checked against the model schema.
  cultureinfo: S(["linguisticMetadata", "contentType"], ["translations", "linguisticMetadata"]),
  culture: S(["linguisticMetadata", "contentType"], ["translations", "linguisticMetadata"]),
  translations: S([], ["model"]),
  linguisticmetadata: S(["contentType", "content"], []),
  datasource: S(["type", "connectionString", "impersonationMode", "account", "maxConnections", "isolation", "timeout",
                 "provider", "description", "contextExpression"], ["connectionDetails", "credential", "options"]),
  connectiondetails: S(["protocol", "authentication", "query"], ["address"]),
  address: S(["server", "database", "url", "path", "resource", "account", "domain", "emailAddress", "connectionString"], []),
  credential: S(["authenticationKind", "kind", "path", "username", "encryptConnection", "privacySetting"], []),
  options: S([], []),
  // Leaves. Their "properties" are their value.
  annotation: S([], []), extendedproperty: S([], []), changedproperty: S([], []), ref: S([], []),
};

/** True when a node sits anywhere under a culture (its subtree mirrors the model, not the schema). */
function underCulture(node) {
  for (let n = node.parent; n; n = n.parent) if (n.type === "cultureinfo" || n.type === "culture" || n.type === "translations") return true;
  return false;
}

/** Enum-valued properties and their legal members (lowercase). Desktop reads them case-insensitively. */
const ENUMS = {
  datatype: ["string", "int64", "double", "decimal", "datetime", "boolean", "binary", "variant", "automatic", "unknown"],
  summarizeby: ["default", "none", "sum", "min", "max", "count", "average", "distinctcount"],
  mode: ["import", "directquery", "default", "push", "directlake", "dual"],
  crossfilteringbehavior: ["onedirection", "bothdirections", "automatic"],
  fromcardinality: ["none", "one", "many"],
  tocardinality: ["none", "one", "many"],
  securityfilteringbehavior: ["onedirection", "bothdirections", "none"],
  joinondatebehavior: ["dateandtime", "datepartonly"],
  modelpermission: ["none", "read", "readrefresh", "refresh", "administrator"],
  metadatapermission: ["default", "none", "read"],
  hidemembers: ["default", "hideblankmembers"],
  defaultpowerbidatasourceversion: ["powerbi_v1", "powerbi_v2", "powerbi_v3"],
  alignment: ["default", "left", "right", "center"],
  encodinghint: ["default", "hash", "value"],
  dataview: ["full", "sample", "default"],
  defaultdataview: ["full", "sample", "default"],
  defaultmode: ["import", "directquery", "default", "push", "directlake", "dual"],
  policytype: ["basic"],
  incrementalgranularity: ["invalid", "day", "month", "quarter", "year"],
  rollingwindowgranularity: ["invalid", "day", "month", "quarter", "year"],
  kind: ["m", "dax"],
  summarization: ["groupby", "sum", "count", "min", "max"],
};

/** Boolean-valued properties: bare, or `: true` / `: false` (case-insensitive). */
const BOOLEANS = new Set([
  "ishidden", "isprivate", "showasvariationsonly", "excludefrommodelrefresh", "systemmanaged",
  "excludefromautomaticaggregations", "iskey", "isnullable", "isunique", "isdefaultlabel", "isdefaultimage",
  "isavailableinmdx", "keepuniquerows", "isnameinferred", "isdatatypeinferred", "isdefault", "isactive",
  "relyonreferentialintegrity", "issimplemeasure", "includeall", "legacyredirects", "returnerrorvaluesasnull",
  "fastcombine", "discourageimplicitmeasures", "discouragereportmeasures", "discouragecompositemodels",
  "forceuniquenames", "disableautoexists", "retaindatatillforcecalculate",
]);

/**
 * Keywords that are real TOM properties and still refused by this Desktop's TMDL reader. Measured
 * 2026-09-05 on 2.157.879.0: "The keyword 'discourageReportMeasures' is neither a property nor an
 * object in the current context!". Kept apart from SCHEMA so the finding can say so.
 */
const REJECTED_BY_DESKTOP = new Set(["discouragereportmeasures"]);

/** Minimum compatibility level per feature, from the TOM reference remarks. */
const MIN_COMPAT = {
  function: 1702,            // DAX user-defined functions
  calendar: 1701,            // calendar-based time intelligence
  calculationgroup: 1470,
  calculationitem: 1470,
  querygroup: 1480,
  formatstringdefinition: 1601,
  refreshpolicy: 1450,
  alternateof: 1460,
};

module.exports = { parseTree, expressionOf, prop, propValue, propBool, kids, unquoteName, indentOf, underCulture,
                   SCHEMA, ENUMS, BOOLEANS, REJECTED_BY_DESKTOP, MIN_COMPAT, UNNAMED };
