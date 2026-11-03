import { createHash } from "node:crypto";
import {
  extractMemoryEntities,
  normalizeStem,
  type ExtractedEntity
} from "./context-memory-hybrid-search.ts";

export interface GraphDocumentInput {
  id: string;
  filename: string;
  format: string;
  text: string;
  updatedAt?: string;
}

export interface CrossCitationLink {
  sourceDocId: string;
  targetDocId: string;
  sourceFilename: string;
  targetFilename: string;
  matchingSentence: string;
  sentenceSha256: string;
  confidence: number;
}

export interface InterDocumentContradiction {
  subjectStem: string;
  docA: { id: string; filename: string; value: string; quote: string };
  docB: { id: string; filename: string; value: string; quote: string };
  severity: "critical" | "warning";
  discrepancyReason: string;
}

export interface DocumentKnowledgeGraph {
  documentCount: number;
  totalSentences: number;
  citations: CrossCitationLink[];
  contradictions: InterDocumentContradiction[];
  documents: Array<{ id: string; filename: string; format: string; charCount: number }>;
  generatedAt: string;
}

function splitSentences(text: string): string[] {
  return String(text ?? "")
    .normalize("NFKC")
    .split(/(?:\r?\n)+|(?<=[.!?])\s+/u)
    .map((s) => s.trim())
    .filter((s) => s.length >= 10 && s.length <= 800);
}

/**
 * Multi-Document Cross-Citation Graph & Inter-Document Contradiction Detector for Local Vault.
 *
 * Capabilities:
 * 1. Analyzes multiple documents in `.kosmora-vault` / Project Materials simultaneously.
 * 2. Identifies cross-document citations (identical/near-identical claims, file references).
 * 3. Detects factual contradictions across documents when numbers, budgets, or dates diverge
 *    on the same core topic.
 */
export class VaultCrossCitationGraphEngine {
  buildKnowledgeGraph(documents: GraphDocumentInput[]): DocumentKnowledgeGraph {
    const citations: CrossCitationLink[] = [];
    const contradictions: InterDocumentContradiction[] = [];
    let totalSentences = 0;

    const docSentences = new Map<string, Array<{ text: string; sha256: string; entities: ExtractedEntity[] }>>();

    for (const doc of documents) {
      const sentences = splitSentences(doc.text);
      totalSentences += sentences.length;
      const parsed = sentences.map((s) => ({
        text: s,
        sha256: createHash("sha256").update(s, "utf8").digest("hex"),
        entities: extractMemoryEntities(s)
      }));
      docSentences.set(doc.id, parsed);
    }

    // 1. Cross-Document Citations: sentence matching or explicit file name references
    for (let i = 0; i < documents.length; i++) {
      const docA = documents[i];
      const sentsA = docSentences.get(docA.id) ?? [];

      for (let j = i + 1; j < documents.length; j++) {
        const docB = documents[j];
        const sentsB = docSentences.get(docB.id) ?? [];

        // Check if docA explicitly mentions docB's filename or vice-versa
        const docANorm = docA.text.toLowerCase();
        const docBNorm = docB.text.toLowerCase();
        const bNameLower = docB.filename.toLowerCase();
        const aNameLower = docA.filename.toLowerCase();

        if (docANorm.includes(bNameLower)) {
          citations.push({
            sourceDocId: docA.id,
            targetDocId: docB.id,
            sourceFilename: docA.filename,
            targetFilename: docB.filename,
            matchingSentence: `Документ ссылается на файл: ${docB.filename}`,
            sentenceSha256: createHash("sha256").update(docB.filename, "utf8").digest("hex"),
            confidence: 0.95
          });
        }
        if (docBNorm.includes(aNameLower)) {
          citations.push({
            sourceDocId: docB.id,
            targetDocId: docA.id,
            sourceFilename: docB.filename,
            targetFilename: docA.filename,
            matchingSentence: `Документ ссылается на файл: ${docA.filename}`,
            sentenceSha256: createHash("sha256").update(docA.filename, "utf8").digest("hex"),
            confidence: 0.95
          });
        }

        // Sentence-level citation matching (identical quotes shared across documents)
        for (const sa of sentsA) {
          for (const sb of sentsB) {
            if (sa.sha256 === sb.sha256 || sa.text.toLowerCase() === sb.text.toLowerCase()) {
              citations.push({
                sourceDocId: docA.id,
                targetDocId: docB.id,
                sourceFilename: docA.filename,
                targetFilename: docB.filename,
                matchingSentence: sa.text,
                sentenceSha256: sa.sha256,
                confidence: 1.0
              });
            }
          }
        }

        // 2. Inter-Document Contradiction Detection (divergent numbers/dates on shared subject stems)
        for (const sa of sentsA) {
          const numDateA = sa.entities.filter(
            (e) => e.kind === "money_or_number" || e.kind === "date"
          );
          if (numDateA.length === 0) continue;

          for (const sb of sentsB) {
            const numDateB = sb.entities.filter(
              (e) => e.kind === "money_or_number" || e.kind === "date"
            );
            if (numDateB.length === 0) continue;

            const wordsA = (sa.text.toLowerCase().match(/[\p{L}]{4,}/gu) ?? []).map(normalizeStem);
            const wordsB = new Set(
              (sb.text.toLowerCase().match(/[\p{L}]{4,}/gu) ?? []).map(normalizeStem)
            );
            const sharedStems = wordsA.filter((w) => wordsB.has(w));

            // If sentences share 2+ meaningful topic stems but have conflicting numbers or dates
            if (sharedStems.length >= 2) {
              const matchedEntA = numDateA[0];
              const matchedEntB = numDateB.find((eb) => eb.kind === matchedEntA.kind);

              if (matchedEntB && matchedEntA.normalized !== matchedEntB.normalized) {
                contradictions.push({
                  subjectStem: sharedStems.slice(0, 3).join(", "),
                  docA: {
                    id: docA.id,
                    filename: docA.filename,
                    value: matchedEntA.raw,
                    quote: sa.text
                  },
                  docB: {
                    id: docB.id,
                    filename: docB.filename,
                    value: matchedEntB.raw,
                    quote: sb.text
                  },
                  severity: matchedEntA.kind === "money_or_number" ? "critical" : "warning",
                  discrepancyReason: `Расхождение значения (${matchedEntA.raw} в ${docA.filename} против ${matchedEntB.raw} в ${docB.filename}) по теме [${sharedStems.join(", ")}]`
                });
              }
            }
          }
        }
      }
    }

    return {
      documentCount: documents.length,
      totalSentences,
      citations,
      contradictions,
      documents: documents.map((d) => ({
        id: d.id,
        filename: d.filename,
        format: d.format,
        charCount: d.text.length
      })),
      generatedAt: new Date().toISOString()
    };
  }
}
