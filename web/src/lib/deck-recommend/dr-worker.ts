import { CachedDataProvider } from "sekai-calculator";
import { buildWasmMasterDataBundle, calcDuration, WASM_MASTER_KEYS, type HarukiServer, SnowyDataProvider } from "./data-provider";
import { SekaiDeckRecommendWasm } from "./sekaiDeckRecommendWasm";
import { buildDeckRecommendWasmPayload, normalizeWasmDeckResults, type WasmCardConfig } from "./wasm-adapter";

interface UserCardEntry {
    cardId: number;
    masterRank?: number;
    [key: string]: unknown;
}

interface EventInfoLite {
    id: number;
    eventType?: string;
}

interface ChallengeResultEntry {
    characterId: number;
    highScore?: number;
    [key: string]: unknown;
}

interface DeckCardLite {
    cardId: number;
    masterRank?: number;
}

interface DeckResultLite {
    score?: number;
    eventBonus?: number;
    supportDeckBonus?: number;
    power?: { total?: number };
    cards?: DeckCardLite[];
    [key: string]: unknown;
}

export interface WorkerInput {
    mode: "challenge" | "event" | "mysekai" | "custom" | "strongest";
    userId: string;
    server: string;
    oauthAccessToken?: string;
    musicId: number;
    difficulty: string;
    characterId?: number;
    eventId?: number;
    liveType?: string;
    supportCharacterId?: number;
    cardConfig: Record<string, WasmCardConfig>;
    customUnit?: string;
    customCharacterIds?: number[];
    customCharacterUnits?: Record<number, string>;
    customAttr?: string;
    customCharacterBonus?: number;
    customAttrBonus?: number;
    leaderCharacter?: number;
    strongestTarget?: "power" | "skill";
}

export interface WorkerOutput {
    type?: "progress" | "result";
    result?: DeckResultLite[];
    challengeHighScore?: ChallengeResultEntry;
    userCards?: UserCardEntry[];
    duration?: number;
    error?: string;
    upload_time?: number;
    stage?: string;
    percent?: number;
    stageLabel?: string;
}

function sendProgress(stage: string, percent: number, stageLabel: string) {
    postMessage({ type: "progress", stage, percent, stageLabel });
}

async function resolveEventLiveType(
    dataProvider: CachedDataProvider,
    eventId: number | undefined,
    liveType: string | undefined,
): Promise<string> {
    const normalized = liveType ?? "multi";
    if (!eventId) {
        return normalized;
    }
    const events = await dataProvider.getMasterData<EventInfoLite>("events");
    const event0 = events.find((it) => it.id === eventId);
    if (!event0) {
        throw new Error(`Event not found: ${eventId}`);
    }
    if (event0.eventType === "cheerful_carnival" && normalized === "multi") {
        return "cheerful";
    }
    return normalized;
}

async function deckRecommendRunner(args: WorkerInput): Promise<WorkerOutput> {
    sendProgress("fetching", 5, "正在获取用户数据...");

    const dataProvider = new CachedDataProvider(
        new SnowyDataProvider(args.userId, args.server as HarukiServer, args.oauthAccessToken || null),
    );

    await Promise.all([
        dataProvider.getUserDataAll(),
        dataProvider.getMusicMeta(),
        dataProvider.preloadMasterData([...WASM_MASTER_KEYS]),
    ]);

    sendProgress("processing", 25, "数据加载完成，整理计算输入...");

    const userDataAll = await dataProvider.getUserDataAll() as Record<string, unknown>;
    const userCards = (Array.isArray(userDataAll.userCards) ? userDataAll.userCards : []) as UserCardEntry[];
    const uploadTime = typeof userDataAll.upload_time === "number" ? userDataAll.upload_time : undefined;

    const effectiveLiveType = args.mode === "event"
        ? await resolveEventLiveType(dataProvider, args.eventId, args.liveType)
        : (args.liveType ?? "multi");

    sendProgress("processing", 40, "正在序列化 WASM 输入...");

    const [masterData, musicMetas] = await Promise.all([
        buildWasmMasterDataBundle(dataProvider),
        dataProvider.getMusicMeta(),
    ]);

    const payload = buildDeckRecommendWasmPayload(
        {
            ...args,
            liveType: effectiveLiveType,
        },
        {
            region: args.server,
            masterData,
            userData: userDataAll,
            musicMetas,
        },
    );

    sendProgress("calculating", 60, "Moesekai 智能组卡计算中...");

    const wasm = new SekaiDeckRecommendWasm();
    await wasm.init();

    const currentDuration = calcDuration();
    const wasmResult = wasm.runRecommend<{ decks?: DeckResultLite[] }>(payload);
    const result = normalizeWasmDeckResults(wasmResult) as DeckResultLite[];

    const challengeResults = Array.isArray(userDataAll.userChallengeLiveSoloResults)
        ? userDataAll.userChallengeLiveSoloResults as ChallengeResultEntry[]
        : [];
    const challengeHighScore = args.mode === "challenge"
        ? challengeResults.find((it) => it.characterId === args.characterId)
        : undefined;

    sendProgress("done", 100, "计算完成");
    return {
        type: "result",
        result,
        challengeHighScore,
        userCards,
        duration: currentDuration.done(),
        upload_time: uploadTime,
    };
}

addEventListener("message", (event: MessageEvent<{ args: WorkerInput }>) => {
    deckRecommendRunner(event.data.args)
        .then((result) => {
            postMessage({ ...result, type: "result" });
        })
        .catch((err) => {
            postMessage({
                type: "result",
                error: err instanceof Error ? err.message : String(err),
            });
        });
});
