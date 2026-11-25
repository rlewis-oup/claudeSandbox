export interface GrammarItem {
  item: string;
  description?: string;
}

export interface VocabularySet {
  topic: string;
  items: string[];
}

export interface Lesson {
  lessonNumber: string;
  title: string;
  grammar: GrammarItem[];
}

export interface ActivityCounts {
  grammar: number;
  vocabulary: number;
  reading: number;
  listening: number;
  speaking: number;
  writing: number;
  total: number;
}

export interface DidacticUnit {
  unitNumber: number | string;
  title: string;
  theme?: string;
  lessons?: Lesson[];
  grammar: GrammarItem[];
  vocabulary: VocabularySet[];
  lexicalItemCount?: number;
  topics: string[];
  activityCounts?: ActivityCounts;
  additionalFeatures?: string[];
}

export interface Coursebook {
  id: string;
  title: string;
  level?: string;
  publisher?: string;
  units: DidacticUnit[];
}
