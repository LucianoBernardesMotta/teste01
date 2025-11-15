export interface Phoneme {
  syllable: string;
  romaji: string;
}

export interface WordData {
  kanji: string | null;
  hiragana: string;
  portuguese: string;
  romaji: string;
  emoji: string;
  imagePrompt: string;
  phonemes: Phoneme[];
  imageUrl: string;
  audioData: string; // Base64 encoded audio
}

export interface Lesson {
  id: string;
  subtitle: string;
  words: WordData[];
  isUserCreated?: boolean;
  createdAt?: string;
}
