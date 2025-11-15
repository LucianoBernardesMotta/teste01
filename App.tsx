import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { APP_TITLE } from './constants';
import type { Lesson, WordData, Phoneme } from './types';
import { DEFAULT_LESSONS } from './lessons-data';
import { getUserLessons, saveUserLesson, deleteUserLesson } from './storage';

// --- HELPER FUNCTIONS ---

const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result.split(',')[1]);
      } else {
        reject(new Error("Failed to convert blob to base64"));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

function decodeB64(base64: string) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

async function decodeAudioData(
    data: Uint8Array,
    ctx: AudioContext,
): Promise<AudioBuffer> {
    // Gemini TTS returns raw 16-bit PCM mono audio at 24kHz
    const sampleRate = 24000;
    const numChannels = 1;
    const dataInt16 = new Int16Array(data.buffer);
    const frameCount = dataInt16.length / numChannels;
    const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < frameCount; i++) {
        channelData[i] = dataInt16[i] / 32768.0;
    }
    return buffer;
}

// New helpers to handle UTF-8 characters for btoa/atob
const utf8_to_b64 = (str: string): string => {
    return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g,
        (match, p1) => String.fromCharCode(parseInt(p1, 16))
    ));
}

const b64_to_utf8 = (str: string): string => {
    return decodeURIComponent(atob(str).split('').map((c) => {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
}


// --- UI COMPONENTS ---

const StarryBackground = React.memo(() => (
  <div className="fixed top-0 left-0 w-full h-full -z-10 overflow-hidden bg-gradient-to-br from-yellow-100 via-pink-100 to-green-100">
    {[...Array(50)].map((_, i) => (
      <div
        key={i}
        className="absolute rounded-full bg-white"
        style={{
          top: `${Math.random() * 100}%`,
          left: `${Math.random() * 100}%`,
          width: `${Math.random() * 3}px`,
          height: `${Math.random() * 3}px`,
          opacity: Math.random() * 0.7 + 0.1,
          animation: `twinkle ${Math.random() * 5 + 3}s linear infinite alternate`,
        }}
      />
    ))}
    <style>{`
      @keyframes twinkle {
        from { opacity: 0.2; transform: scale(0.8); }
        to { opacity: 0.7; transform: scale(1.2); }
      }
    `}</style>
  </div>
));

const Spinner = ({ message }: { message: string }) => (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex flex-col items-center justify-center z-50 text-white">
        <div className="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-lg font-semibold">{message}</p>
    </div>
);

const Confetti = React.memo(() => {
    const colors = ['#fde68a', '#86efac', '#f9a8d4', '#a5b4fc', '#fef08a'];
    return (
        <div className="absolute inset-0 w-full h-full pointer-events-none overflow-hidden z-50">
            {Array.from({ length: 150 }).map((_, i) => {
                const style = {
                    left: `${Math.random() * 100}%`,
                    backgroundColor: colors[Math.floor(Math.random() * colors.length)],
                    animation: `fall ${Math.random() * 2 + 3}s linear ${Math.random() * 5}s infinite`,
                    width: `${Math.random() * 12 + 5}px`,
                    height: `${Math.random() * 12 + 5}px`,
                    opacity: Math.random(),
                };
                return <div key={i} className="absolute top-[-20%] rounded-full" style={style} />;
            })}
            <style>{`
                @keyframes fall {
                    to {
                        transform: translateY(100vh) rotate(${Math.random() * 720}deg);
                        opacity: 0;
                    }
                }
            `}</style>
        </div>
    );
});

const ImportLessonModal = ({
  lesson,
  onConfirm,
  onCancel,
}: {
  lesson: Lesson;
  onConfirm: () => void;
  onCancel: () => void;
}) => (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-40 p-4">
    <div className="bg-white rounded-2xl p-6 md:p-8 shadow-2xl w-full max-w-md text-center">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">Lição Recebida!</h2>
      <p className="text-gray-600 mb-6">
        Você recebeu a lição "<span className="font-bold">{lesson.subtitle}</span>" com {lesson.words.length} palavras. Deseja salvá-la em sua lista?
      </p>
      <div className="flex justify-center gap-4">
        <button
          onClick={onCancel}
          className="px-6 py-2 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition-colors"
        >
          Ignorar
        </button>
        <button
          onClick={onConfirm}
          className="px-6 py-2 bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 transition-colors shadow-lg"
        >
          Salvar Lição
        </button>
      </div>
    </div>
  </div>
);


const NewLessonModal = ({
  setShow,
  createLesson,
}: {
  setShow: (show: boolean) => void;
  createLesson: (subtitle: string, words: string) => Promise<void>;
}) => {
  const [subtitle, setSubtitle] = useState('');
  const [words, setWords] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (subtitle.trim() && words.trim()) {
      createLesson(subtitle.trim(), words.trim());
      setShow(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-30 p-4">
      <div className="bg-white rounded-2xl p-6 md:p-8 shadow-2xl w-full max-w-md transform transition-all scale-100">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">Criar Nova Lição</h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="subtitle" className="block text-gray-700 font-semibold mb-2">Subtítulo da Lição</label>
            <input
              type="text"
              id="subtitle"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="Ex: Animais, Cores, Números"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
              required
            />
          </div>
          <div className="mb-6">
            <label htmlFor="words" className="block text-gray-700 font-semibold mb-2">Palavras em Japonês (uma por linha)</label>
            <textarea
              id="words"
              value={words}
              onChange={(e) => setWords(e.target.value)}
              placeholder="犬&#10;猫&#10;鳥"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg h-32 resize-none focus:outline-none focus:ring-2 focus:ring-yellow-400"
              required
            ></textarea>
          </div>
          <div className="flex justify-end gap-4">
            <button
              type="button"
              onClick={() => setShow(false)}
              className="px-6 py-2 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-6 py-2 bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 transition-colors shadow-lg"
            >
              Salvar Lição
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const CompletionModal = ({
    setShow,
    crystals,
    onRestart,
}: {
    setShow: (show: boolean) => void;
    crystals: number;
    onRestart: () => void;
}) => (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-40 p-4">
        <Confetti />
        <div className="bg-white rounded-2xl p-8 shadow-2xl text-center relative transform transition-all scale-100 animate-jump-in">
            <h2 className="text-4xl font-bold text-yellow-500 mb-4">Parabéns! 🎉</h2>
            <p className="text-gray-700 text-lg mb-6">Você completou a lição e aprendeu novas palavras!</p>
            <p className="text-2xl font-semibold text-gray-800 mb-8">Você tem {crystals} 💎 cristais!</p>
            <div className="flex justify-center gap-4">
               <button onClick={onRestart} className="px-6 py-3 bg-yellow-400 text-yellow-900 font-bold rounded-lg hover:bg-yellow-500 transition-transform transform hover:scale-105 shadow-lg">
                    Praticar de Novo
                </button>
                <button onClick={() => setShow(false)} className="px-6 py-3 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition-colors">
                    Fechar
                </button>
            </div>
        </div>
        <style>{`
            @keyframes jump-in {
                0% { transform: scale(0.5); opacity: 0; }
                80% { transform: scale(1.05); opacity: 1; }
                100% { transform: scale(1); opacity: 1; }
            }
            .animate-jump-in { animation: jump-in 0.5s ease-out forwards; }
        `}</style>
    </div>
);


const PhonemeHighlighter = React.memo(({ phonemes }: { phonemes: Phoneme[] }) => (
    <div className="flex flex-wrap justify-center gap-2 mt-4">
        {phonemes.map((p, index) => (
            <div key={index} className="bg-green-100 text-green-800 rounded-lg px-3 py-1 text-center">
                <p className="text-lg font-semibold">{p.syllable}</p>
                <p className="text-sm">{p.romaji}</p>
            </div>
        ))}
    </div>
));

const WordCard = React.memo(({ word, playAudio }: { word: WordData, playAudio: (data: string) => void }) => (
    <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-lg p-4 md:p-6 w-full max-w-2xl mx-auto flex flex-col items-center">
        <div className="w-full aspect-video rounded-2xl mb-4 overflow-hidden bg-gray-200 flex items-center justify-center">
            {word.imageUrl ? (
                <img src={word.imageUrl} alt={word.portuguese} className="w-full h-full object-cover" />
            ) : (
                <p className="text-6xl animate-pulse">{word.emoji}</p>
            )}
        </div>

        <div className="text-center">
            {word.kanji && <p className="text-5xl font-bold text-gray-800">{word.kanji}</p>}
            <p className="text-3xl text-gray-700">{word.hiragana}</p>
            <p className="text-xl text-gray-500 mt-1">{word.romaji}</p>
            <p className="text-2xl font-semibold text-blue-600 mt-2">{word.portuguese} {word.emoji}</p>
        </div>

        <div className="w-full mt-6">
            <h3 className="text-center font-bold text-lg text-gray-700 mb-2">Pronúncia</h3>
             <button onClick={() => playAudio(word.audioData)} className="mx-auto flex items-center justify-center w-16 h-16 bg-yellow-400 rounded-full text-4xl hover:bg-yellow-500 transition-transform transform hover:scale-110 shadow-md" aria-label="Ouvir pronúncia">
                🔊
            </button>
            <PhonemeHighlighter phonemes={word.phonemes} />
        </div>
    </div>
));

const BottomBar = React.memo(({ onNext, wordIndex, totalWords, crystals }: { onNext: () => void; wordIndex: number; totalWords: number; crystals: number; }) => (
    <div className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-sm shadow-2xl p-2 md:p-4 z-20">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2 w-1/3">
                 <div className="bg-white rounded-lg p-2 shadow-md hidden md:block">
                    <p className="text-sm font-semibold text-gray-700">Você consegue! 🌟</p>
                </div>
            </div>
            <div className="flex-grow text-center w-1/3">
                <p className="font-bold text-gray-600">Palavra {wordIndex + 1} de {totalWords}</p>
                <p className="text-2xl font-bold text-yellow-500">💎 {crystals}</p>
            </div>
            <div className="w-1/3 flex justify-end">
                <button
                    onClick={onNext}
                    className="bg-gradient-to-r from-pink-400 to-yellow-400 text-white font-bold py-3 px-6 rounded-full shadow-lg transform transition-transform hover:scale-105"
                >
                    Aprendi! ⭐ →
                </button>
            </div>
        </div>
    </div>
));

const LessonView = ({
    lesson,
    goBack,
    updateCrystals
}: {
    lesson: Lesson;
    goBack: () => void;
    updateCrystals: () => void;
}) => {
    const [wordIndex, setWordIndex] = useState(0);
    const [showCompletion, setShowCompletion] = useState(false);
    const [crystals, setCrystals] = useState(() => parseInt(localStorage.getItem('kotoba-sensei-crystals') || '7'));
    const learnedWords = useRef(new Set<number>());
    
    const audioContextRef = useRef<AudioContext | null>(null);

    useEffect(() => {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }, []);

    const playAudio = useCallback(async (audioData: string) => {
        if (!audioData || !audioContextRef.current) return;
        try {
            const decodedBytes = decodeB64(audioData);
            const audioBuffer = await decodeAudioData(decodedBytes, audioContextRef.current);
            const source = audioContextRef.current.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContextRef.current.destination);
            source.start();
        } catch (error) {
            console.error("Failed to play audio:", error);
        }
    }, []);

    const handleNext = () => {
        if (!learnedWords.current.has(wordIndex)) {
            learnedWords.current.add(wordIndex);
            const newCrystals = crystals + 1;
            setCrystals(newCrystals);
            localStorage.setItem('kotoba-sensei-crystals', newCrystals.toString());
            updateCrystals();
            if (learnedWords.current.size === lesson.words.length) {
                setShowCompletion(true);
            }
        }
        setWordIndex((prevIndex) => (prevIndex + 1) % lesson.words.length);
    };
    
    const restartLesson = () => {
        setShowCompletion(false);
        learnedWords.current.clear();
        setWordIndex(0);
    }

    return (
        <div className="min-h-screen flex flex-col pt-4 pb-28 md:pb-32">
            <header className="px-4 md:px-8 mb-4">
                <div className="max-w-4xl mx-auto flex justify-between items-center">
                    <button onClick={goBack} className="bg-white/80 backdrop-blur-sm text-gray-700 font-semibold py-2 px-4 rounded-lg shadow-md hover:bg-gray-200 transition-colors">
                        ← Voltar
                    </button>
                    <div className='text-right'>
                        <h1 className="text-xl md:text-2xl font-bold text-gray-800">{APP_TITLE}</h1>
                        <p className="text-md md:text-lg text-gray-600">1º Ano - {lesson.subtitle}</p>
                    </div>
                </div>
            </header>
            <main className="flex-grow flex items-center justify-center p-4">
                <WordCard word={lesson.words[wordIndex]} playAudio={playAudio} />
            </main>
            <BottomBar onNext={handleNext} wordIndex={wordIndex} totalWords={lesson.words.length} crystals={crystals} />
            {showCompletion && <CompletionModal setShow={setShowCompletion} crystals={crystals} onRestart={restartLesson}/>}
        </div>
    );
};

const Dashboard = ({
    onNewLesson,
    onSelectLesson,
    userLessons,
    onDeleteLesson,
    onShareLesson,
}: {
    onNewLesson: () => void;
    onSelectLesson: (id: string) => void;
    userLessons: Lesson[];
    onDeleteLesson: (id: string) => void;
    onShareLesson: (id: string) => void;
}) => {
    const [copiedId, setCopiedId] = useState<string | null>(null);

    const handleShare = (id: string) => {
        onShareLesson(id);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    }

    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-4 text-center">
            <h1 className="text-4xl md:text-5xl font-bold text-gray-800 mb-4">{APP_TITLE}</h1>
            <p className="text-gray-600 mt-2 mb-8 text-lg">Vamos aprender Japonês de um jeito divertido!</p>
            <button
                onClick={onNewLesson}
                className="bg-gradient-to-r from-yellow-400 to-pink-500 text-white font-bold py-4 px-8 rounded-full shadow-xl transform transition-transform hover:scale-105 text-xl"
            >
                Criar Nova Lição
            </button>
            <div className="mt-12 w-full max-w-md">
                <h2 className="text-2xl font-bold text-gray-700 mb-4">Minhas Lições ({userLessons.length})</h2>
                {userLessons.length > 0 ? (
                    <div className="space-y-3">
                        {userLessons.map((lesson) => (
                           <div key={lesson.id} className="flex items-center gap-2 group">
                                <button onClick={() => onSelectLesson(lesson.id)} className="flex-grow text-left p-4 bg-white rounded-lg shadow-md hover:shadow-lg hover:bg-yellow-50 transition-all w-full">
                                   <span className="font-bold text-lg text-gray-800">{lesson.subtitle}</span>
                                   <span className="text-sm text-gray-500 ml-2">({lesson.words.length} palavras)</span>
                                </button>
                                <button 
                                    onClick={() => handleShare(lesson.id)}
                                    className="p-3 bg-blue-100 text-blue-600 rounded-full hover:bg-blue-200 transition-all"
                                    aria-label={`Compartilhar lição ${lesson.subtitle}`}
                                >
                                    {copiedId === lesson.id ? (
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-600" viewBox="0 0 20 20" fill="currentColor">
                                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                        </svg>
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                            <path d="M15 8a3 3 0 10-2.977-2.63l-4.94 2.47a3 3 0 100 4.319l4.94 2.47a3 3 0 10.895-1.789l-4.94-2.47a3.027 3.027 0 000-.74l4.94-2.47C13.456 7.68 14.19 8 15 8z" />
                                        </svg>
                                    )}
                                </button>
                                <button 
                                    onClick={() => onDeleteLesson(lesson.id)} 
                                    className="p-3 bg-red-100 text-red-600 rounded-full hover:bg-red-200 transition-all opacity-0 group-hover:opacity-100"
                                    aria-label={`Excluir lição ${lesson.subtitle}`}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clipRule="evenodd" />
                                    </svg>
                                </button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-gray-500">Nenhuma lição criada ainda. Crie uma para começar!</p>
                )}
            </div>
        </div>
    );
}

// --- MAIN APP ---

const App = () => {
    const [view, setView] = useState<'dashboard' | 'lesson'>('dashboard');
    const [userLessons, setUserLessons] = useState<Lesson[]>([]);
    const [activeLesson, setActiveLesson] = useState<Lesson | null>(null);
    const [crystals, setCrystals] = useState(7);
    const [isLoading, setIsLoading] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState('');
    const [showNewLessonModal, setShowNewLessonModal] = useState(false);
    const [lessonToImport, setLessonToImport] = useState<Lesson | null>(null);

    useEffect(() => {
        setUserLessons(getUserLessons());
        const savedCrystals = localStorage.getItem('kotoba-sensei-crystals');
        if (savedCrystals) {
            setCrystals(parseInt(savedCrystals, 10));
        }

        // Check for shared lesson in URL
        const params = new URLSearchParams(window.location.search);
        const lessonData = params.get('lessonData');
        if (lessonData) {
            try {
                const decodedString = b64_to_utf8(lessonData);
                const lesson = JSON.parse(decodedString) as Lesson;
                setLessonToImport(lesson);
                // Clean the URL
                window.history.replaceState({}, document.title, window.location.pathname);
            } catch (error) {
                console.error("Failed to parse shared lesson data:", error);
                alert("O link da lição compartilhada parece estar corrompido.");
            }
        }
    }, []);

    const updateCrystals = () => {
        const savedCrystals = localStorage.getItem('kotoba-sensei-crystals');
        if (savedCrystals) {
            setCrystals(parseInt(savedCrystals, 10));
        }
    }

    const handleImportLesson = () => {
      if (lessonToImport) {
        // Assign new unique ID to prevent conflicts
        const newLesson = { ...lessonToImport, id: Date.now().toString() };
        saveUserLesson(newLesson);
        setUserLessons(prev => [...prev, newLesson]);
        setLessonToImport(null);
        alert(`Lição "${newLesson.subtitle}" salva com sucesso!`);
      }
    };

    const createLesson = async (subtitle: string, wordsInput: string) => {
        setIsLoading(true);
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            const words = wordsInput.split('\n').filter(w => w.trim() !== '');
            const newWordsData: WordData[] = [];

            const wordDetailSchema = {
                type: Type.OBJECT,
                properties: {
                    kanji: { type: Type.STRING, description: "The Japanese word in Kanji. If not applicable, return an empty string." },
                    hiragana: { type: Type.STRING, description: "The Japanese word in Hiragana." },
                    portuguese: { type: Type.STRING, description: "The Portuguese translation." },
                    romaji: { type: Type.STRING, description: "The romaji of the word." },
                    emoji: { type: Type.STRING, description: "A single emoji that represents the word." },
                    imagePrompt: { type: Type.STRING, description: "A simple, child-friendly English prompt for an image generation model to create a cute, vibrant watercolor illustration of the word. E.g., 'A cute, smiling cartoon dog, watercolor style'." },
                    phonemes: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: { syllable: { type: Type.STRING }, romaji: { type: Type.STRING } },
                            required: ["syllable", "romaji"]
                        }
                    }
                },
                required: ["hiragana", "portuguese", "romaji", "emoji", "imagePrompt", "phonemes"]
            };

            for (let i = 0; i < words.length; i++) {
                const word = words[i];
                setLoadingMessage(`Analisando "${word}" (${i + 1}/${words.length})`);
                const prompt = `Gere os detalhes para a palavra japonesa "${word}" para uma criança brasileira de 6 anos.`;

                const textResponse = await ai.models.generateContent({
                    model: "gemini-2.5-flash",
                    contents: prompt,
                    config: {
                        responseMimeType: "application/json",
                        responseSchema: wordDetailSchema,
                    },
                });

                const details = JSON.parse(textResponse.text);

                setLoadingMessage(`Criando imagem para "${word}"...`);
                
                const imagePromptTemplate = `Create a cheerful, colorful illustration for teaching children Japanese words. 
Style: bright, playful, child-friendly cartoon art with soft colors and rounded shapes. 
Include: ${details.imagePrompt}, warm and inviting atmosphere, 
vibrant colors (pastels and bright hues), no scary elements, 
suitable for ages 5-10, educational but fun, high quality illustration.
IMPORTANT: The illustration must not contain any text, letters, or words in any language.`;

                const imageResponse = await ai.models.generateContent({
                    model: 'gemini-2.5-flash-image',
                    contents: { parts: [{ text: imagePromptTemplate }] },
                    config: { responseModalities: [Modality.IMAGE] },
                });
                
                let imageUrl = '';
                const imagePart = imageResponse.candidates?.[0]?.content?.parts?.[0];
                if (imagePart && imagePart.inlineData) {
                    const base64ImageBytes = imagePart.inlineData.data;
                    imageUrl = `data:${imagePart.inlineData.mimeType};base64,${base64ImageBytes}`;
                }

                setLoadingMessage(`Gravando áudio para "${word}"...`);
                const syllables = details.phonemes.map((p: Phoneme) => p.syllable).join('... ');
                const audioPrompt = `A palavra em japonês é: ${details.hiragana}. Soletrando em hiragana, temos: ${syllables}. Agora, tente soletrar comigo. Vamos lá: ${syllables}. Mais uma vez, juntos: ${syllables}. Excelente! Agora, vamos dizer a palavra inteira, devagarinho, como se lê em hiragana: ${details.hiragana}. Essa palavra significa "${details.portuguese}". Você aprende muito rápido! Parabéns!`;

                const audioResponse = await ai.models.generateContent({
                    model: 'gemini-2.5-flash-preview-tts',
                    contents: [{ parts: [{ text: audioPrompt }] }],
                    config: { 
                        responseModalities: [Modality.AUDIO],
                        speechConfig: {
                            voiceConfig: {
                              prebuiltVoiceConfig: { voiceName: 'Puck' },
                            },
                        },
                    }
                });

                let audioData = '';
                const audioPart = audioResponse.candidates?.[0]?.content?.parts?.[0];
                if (audioPart && audioPart.inlineData) {
                     audioData = audioPart.inlineData.data;
                }

                newWordsData.push({ ...details, kanji: details.kanji || null, imageUrl, audioData });
            }

            const newLesson: Lesson = { 
              id: Date.now().toString(),
              subtitle, 
              words: newWordsData,
              isUserCreated: true,
              createdAt: new Date().toISOString(),
            };
            saveUserLesson(newLesson);
            setUserLessons(prev => [...prev, newLesson]);
            setActiveLesson(newLesson);
            setView('lesson');

        } catch (error) {
            console.error("Error creating lesson:", error);
            alert("Ocorreu um erro ao criar a lição. Verifique o console para mais detalhes.");
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
        }
    };

    const selectLesson = (id: string) => {
        const allLessons = [...DEFAULT_LESSONS, ...userLessons];
        const lesson = allLessons.find(l => l.id === id);
        if(lesson) {
            setActiveLesson(lesson);
            setView('lesson');
        }
    };
    
    const handleDeleteLesson = (id: string) => {
        if(window.confirm("Você tem certeza que quer excluir esta lição? Esta ação não pode ser desfeita.")){
            deleteUserLesson(id);
            setUserLessons(prev => prev.filter(l => l.id !== id));
        }
    }

    const handleShareLesson = (id: string) => {
        const lesson = userLessons.find(l => l.id === id);
        if (lesson) {
            try {
                const lessonString = JSON.stringify(lesson);
                const encodedData = utf8_to_b64(lessonString);
                const shareUrl = `${window.location.origin}${window.location.pathname}?lessonData=${encodedData}`;
                navigator.clipboard.writeText(shareUrl);
            } catch (error) {
                console.error("Failed to create share link:", error);
                alert("Não foi possível criar o link de compartilhamento.");
            }
        }
    };


    const goBackToDashboard = () => {
        setActiveLesson(null);
        setView('dashboard');
    }

    return (
        <div className="font-sans">
            <StarryBackground />
            {isLoading && <Spinner message={loadingMessage} />}
            {showNewLessonModal && <NewLessonModal setShow={setShowNewLessonModal} createLesson={createLesson} />}
            {lessonToImport && (
              <ImportLessonModal 
                lesson={lessonToImport} 
                onConfirm={handleImportLesson}
                onCancel={() => setLessonToImport(null)}
              />
            )}


            {view === 'dashboard' ? (
                <Dashboard 
                    onNewLesson={() => setShowNewLessonModal(true)} 
                    onSelectLesson={selectLesson} 
                    userLessons={userLessons}
                    onDeleteLesson={handleDeleteLesson}
                    onShareLesson={handleShareLesson}
                />
            ) : activeLesson ? (
                <LessonView
                    lesson={activeLesson}
                    goBack={goBackToDashboard}
                    updateCrystals={updateCrystals}
                />
            ) : (
                <Dashboard 
                    onNewLesson={() => setShowNewLessonModal(true)} 
                    onSelectLesson={selectLesson} 
                    userLessons={userLessons}
                    onDeleteLesson={handleDeleteLesson}
                    onShareLesson={handleShareLesson}
                />
            )}
        </div>
    );
};

export default App;