/**
 * Fractal Tiered Memory Engine for Kosmora (L1 / L2 / L3).
 */

export interface MemoryFact {
  id: string;
  category: "architecture" | "stack" | "preference" | "constraint" | "decision";
  key: string;
  value: string;
  confidence: number;
  updated_at: string;
}

export interface TieredMemoryState {
  chat_id: string;
  branch_id: string;
  summary: string;
  summary_tree?: Array<{ level: number; text: string }>;
  facts: MemoryFact[];
  raw_notes: string;
}

export class MemoryHierarchyManager {
  static selectRelevantFacts(
    facts: MemoryFact[],
    queryText: string,
    limit = 5
  ): MemoryFact[] {
    if (!facts.length || !queryText) return facts.slice(0, limit);
    const normalizedQuery = queryText.toLowerCase();

    const scored = facts.map((fact) => {
      let score = fact.confidence ?? 1;
      const keyWords = (fact.key + " " + fact.value + " " + fact.category)
        .toLowerCase()
        .split(/\s+/);
      for (const word of keyWords) {
        if (word.length > 2 && normalizedQuery.includes(word)) {
          score += 2;
        }
      }
      return { fact, score };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.fact);
  }

  static buildPromptContext(
    memory: TieredMemoryState,
    latestUserQuery = ""
  ): string {
    const sections: string[] = [];

    if (memory.summary && memory.summary.trim()) {
      sections.push(
        `[СВОДКА ПРЕДЫДУЩИХ ЭТАПОВ ДИАЛОГА (L2)]:\n${memory.summary.trim()}`
      );
    }

    const relevantFacts = this.selectRelevantFacts(
      memory.facts,
      latestUserQuery,
      6
    );
    if (relevantFacts.length > 0) {
      const factLines = relevantFacts
        .map((f) => `• [${f.category}] ${f.key}: ${f.value}`)
        .join("\n");
      sections.push(
        `[БАНК ДОЛГОВРЕМЕННЫХ ЗНАНИЙ И ПРАВИЛ ПРОЕКТА (L3)]:\n${factLines}`
      );
    }

    if (memory.raw_notes && memory.raw_notes.trim()) {
      sections.push(
        `[ПОСТОЯННЫЕ ЗАМЕТКИ ДИАЛОГА]:\n${memory.raw_notes.trim()}`
      );
    }

    return sections.join("\n\n");
  }

  static parseMemoryNotes(rawNotes: string): { facts: MemoryFact[]; textNotes: string } {
    if (!rawNotes) return { facts: [], textNotes: "" };
    try {
      const parsed = JSON.parse(rawNotes);
      if (Array.isArray(parsed.facts)) {
        return {
          facts: parsed.facts as MemoryFact[],
          textNotes: typeof parsed.textNotes === "string" ? parsed.textNotes : ""
        };
      }
    } catch {
      // Legacy plain text
    }
    return { facts: [], textNotes: rawNotes };
  }

  static serializeMemoryNotes(facts: MemoryFact[], textNotes: string): string {
    if (!facts.length) return textNotes;
    return JSON.stringify({ facts, textNotes });
  }
}
