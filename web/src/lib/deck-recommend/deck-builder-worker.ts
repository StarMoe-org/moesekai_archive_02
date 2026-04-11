import { CachedDataProvider } from "sekai-calculator";
import { buildWasmMasterDataBundle, calcDuration, WASM_MASTER_KEYS, type HarukiServer, SnowyDataProvider } from "./data-provider";
import { SekaiDeckRecommendWasm } from "./sekaiDeckRecommendWasm";
import { buildDeckRecommendWasmPayload, normalizeWasmDeckResults, type WasmCardConfig } from "./wasm-adapter";

interface UserCardEntry {
    cardId: number;
    [key: string]: unknown;
}

interface EventInfoLite {
    id: number;
    eventType?: string;
}

type DeckResultRow = Record<string, unknown>;

export interface DeckBuilderInput {
    userId: string;
    server: string;
    oauthAccessToken?: string;
    eventId: number;
    minBonus: number;
    maxBonus: number;
    liveType: string;
    musicId: number;
    difficulty: string;
    supportCharacterId?: number;
    cardConfig: Record<string, WasmCardConfig>;
}

export interface DeckBuilderOutput {
    result?: DeckResultRow[];
    userCards?: UserCardEntry[];
    duration?: number;
    error?: string;
    upload_time?: number;
}

async function resolveEventLiveType(
    dataProvider: CachedDataProvider,
    eventId: number,
    liveType: string,
): Promise<string> {
    const events = await dataProvider.getMasterData<EventInfoLite>("events");
    const event0 = events.find((it) => it.id === eventId);
    if (!event0) {
        throw new Error(`Event not found: ${eventId}`);
    }
    if (event0.eventType === "cheerful_carnival" && liveType === "multi") {
        return "cheerful";
    }
    return liveType;
}

async function deckBuilderRunner(args: DeckBuilderInput): Promise<DeckBuilderOutput> {
    const dataProvider = new CachedDataProvider(
        new SnowyDataProvider(args.userId, args.server as HarukiServer, args.oauthAccessToken || null),
    );

    await Promise.all([
        dataProvider.getUserDataAll(),
        dataProvider.getMusicMeta(),
        dataProvider.preloadMasterData([...WASM_MASTER_KEYS]),
    ]);

    const userDataAll = await dataProvider.getUserDataAll() as Record<string, unknown>;
    const userCards = (Array.isArray(userDataAll.userCards) ? userDataAll.userCards : []) as UserCardEntry[];
    const uploadTime = typeof userDataAll.upload_time === "number" ? userDataAll.upload_time : undefined;
    const effectiveLiveType = await resolveEventLiveType(dataProvider, args.eventId, args.liveType);

    const [masterData, musicMetas] = await Promise.all([
        buildWasmMasterDataBundle(dataProvider),
        dataProvider.getMusicMeta(),
    ]);

    const payload = buildDeckRecommendWasmPayload(
        {
            ...args,
            mode: "bonus",
            liveType: effectiveLiveType,
        },
        {
            region: args.server,
            masterData,
            userData: userDataAll,
            musicMetas,
        },
    );

    const wasm = new SekaiDeckRecommendWasm();
    await wasm.init();

    const currentDuration = calcDuration();
    const wasmResult = wasm.runRecommend<{ decks?: DeckResultRow[] }>(payload);
    const result = normalizeWasmDeckResults(wasmResult);

    return {
        result,
        userCards,
        duration: currentDuration.done(),
        upload_time: uploadTime,
    };
}

addEventListener("message", (event: MessageEvent<{ args: DeckBuilderInput }>) => {
    deckBuilderRunner(event.data.args)
        .then((output) => {
            postMessage(output);
        })
        .catch((err) => {
            postMessage({
                error: err instanceof Error ? err.message : String(err),
            });
        });
});
