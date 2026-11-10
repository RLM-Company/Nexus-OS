"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

/**
 * GraphQL Schema Definition Language (.graphql SDL) & W3C JSON-LD 1.1 Linked Data
 * Context (.jsonld) Bundle Builder for Kosmora Desktop Workspace.
 */
class GraphqlSdlAndJsonLdBundleBuilder {
  static buildBundle(spec) {
    const schemaName = spec.schemaName || "KosmoraKnowledgeGraph";
    const baseIri = spec.baseIri || "https://kosmora.ai/vocab#";
    const types = Array.isArray(spec.types) ? spec.types : [];
    const queries = Array.isArray(spec.queries) ? spec.queries : [];
    const mutations = Array.isArray(spec.mutations) ? spec.mutations : [];

    const sdlLines = [
      `# GraphQL SDL Schema: ${schemaName}`,
      `directive @semantic(iri: String!) on OBJECT | FIELD_DEFINITION`,
      `scalar DateTime`,
      `scalar JSON`
    ];

    const jsonLdContext = {
      "@version": 1.1,
      "@vocab": baseIri,
      xsd: "http://www.w3.org/2001/XMLSchema#",
      schema: "https://schema.org/"
    };

    for (const t of types) {
      const typeIri = t.semanticIri || `${baseIri}${t.name}`;
      jsonLdContext[t.name] = typeIri;
      sdlLines.push("");
      sdlLines.push(`type ${t.name} @semantic(iri: "${typeIri}") {`);
      for (const f of t.fields || []) {
        const fieldIri = f.semanticIri || `${baseIri}${t.name}/${f.name}`;
        jsonLdContext[`${t.name}.${f.name}`] = {
          "@id": fieldIri,
          "@type": f.gqlType.replace(/[!]/g, "")
        };
        sdlLines.push(`  ${f.name}: ${f.gqlType} @semantic(iri: "${fieldIri}")`);
      }
      sdlLines.push(`}`);
    }

    if (queries.length > 0) {
      sdlLines.push("");
      sdlLines.push("type Query {");
      for (const q of queries) {
        const argsStr =
          Array.isArray(q.args) && q.args.length > 0
            ? `(${q.args.map((a) => `${a.name}: ${a.gqlType}`).join(", ")})`
            : "";
        sdlLines.push(`  ${q.name}${argsStr}: ${q.returnType}`);
      }
      sdlLines.push("}");
    }

    if (mutations.length > 0) {
      sdlLines.push("");
      sdlLines.push("type Mutation {");
      for (const m of mutations) {
        const argsStr =
          Array.isArray(m.args) && m.args.length > 0
            ? `(${m.args.map((a) => `${a.name}: ${a.gqlType}`).join(", ")})`
            : "";
        sdlLines.push(`  ${m.name}${argsStr}: ${m.returnType}`);
      }
      sdlLines.push("}");
    }

    const graphqlSdlText = sdlLines.join("\n") + "\n";
    const jsonLdDocument = {
      "@context": jsonLdContext,
      "@id": `${baseIri}${schemaName}`,
      "@type": "schema:DataCatalog",
      name: schemaName,
      entities: spec.entities || []
    };
    const jsonLdText = JSON.stringify(jsonLdDocument, null, 2) + "\n";

    const bundleSha256 = crypto
      .createHash("sha256")
      .update(graphqlSdlText)
      .update(jsonLdText)
      .digest("hex");

    return {
      graphqlSdlText,
      jsonLdDocument,
      jsonLdText,
      bundleSha256
    };
  }

  static writeBundleFiles(outputDir, baseName, spec) {
    fs.mkdirSync(outputDir, { recursive: true });
    const built = GraphqlSdlAndJsonLdBundleBuilder.buildBundle(spec);
    const graphqlPath = path.join(outputDir, `${baseName}.graphql`);
    const jsonldPath = path.join(outputDir, `${baseName}.jsonld`);
    fs.writeFileSync(graphqlPath, built.graphqlSdlText, "utf8");
    fs.writeFileSync(jsonldPath, built.jsonLdText, "utf8");
    return {
      ...built,
      graphqlPath,
      jsonldPath
    };
  }
}

module.exports = { GraphqlSdlAndJsonLdBundleBuilder };
