export interface GrammarItem {
  item: string;
  description?: string;
}

export interface VocabularySet {
  topic: string;
  items: string[];
}

export interface DidacticUnit {
  unitNumber: number | string;
  title: string;
  grammar: GrammarItem[];
  vocabulary: VocabularySet[];
  topics: string[];
}

export interface Coursebook {
  id: string;
  title: string;
  level?: string;
  publisher?: string;
  units: DidacticUnit[];
}

export interface ComparisonData {
  commonGrammar: string[];
  uniqueGrammar: Record<string, string[]>;
  commonVocabulary: string[];
  uniqueVocabulary: Record<string, string[]>;
  suggestedSyllabus: DidacticUnit[];
}
