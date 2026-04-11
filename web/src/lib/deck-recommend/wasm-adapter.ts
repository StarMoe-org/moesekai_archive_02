export interface WasmCardConfig {
    disable?: boolean;
    rankMax?: boolean;
    episodeRead?: boolean;
    masterMax?: boolean;
    skillMax?: boolean;
    canvas?: boolean;
}

export interface DeckRecommendWasmArgs {
    mode: "challenge" | "event" | "mysekai" | "custom" | "strongest" | "bonus";
    userId: string;
    server: string;
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
    minBonus?: number;
    maxBonus?: number;
}

export interface WasmBundleInput {
    region: string;
    masterData: Record<string, unknown[]>;
    userData: Record<string, unknown>;
    musicMetas: unknown[];
}

export type DeckResultRow = Record<string, unknown>;

export interface CustomBonusRulePayload {
    unit?: string;
    attr?: string;
    characterId?: number;
    supportUnit?: string;
    bonusRate: number;
}

const UNIT_ALIAS_TO_CPP: Record<string, string> = {
    any: "any",
    none: "none",
    leo_need: "light_sound",
    light_sound: "light_sound",
    more_more_jump: "idol",
    idol: "idol",
    vivid_bad_squad: "street",
    street: "street",
    wonderlands_showtime: "theme_park",
    theme_park: "theme_park",
    nightcord_at_25: "school_refusal",
    school_refusal: "school_refusal",
    piapro: "piapro",
};

function toCppUnit(unit?: string): string | undefined {
    if (!unit) {
        return undefined;
    }
    return UNIT_ALIAS_TO_CPP[unit] ?? unit;
}

export function buildCustomBonusConfig(
    characterIds?: number[],
    attr?: string,
    characterBonus: number = 25,
    attrBonus: number = 25,
    characterUnits?: Record<number, string>,
    unit?: string,
    unitBonus: number = 25,
): { rules: CustomBonusRulePayload[] } {
    const rules: CustomBonusRulePayload[] = [];

    if (unit) {
        const mappedUnit = toCppUnit(unit);
        if (mappedUnit) {
            rules.push({ unit: mappedUnit, bonusRate: unitBonus });
        }
    }

    if (characterIds) {
        for (const cid of characterIds) {
            const isVirtualSinger = cid >= 21 && cid <= 26;
            const selectedUnit = toCppUnit(characterUnits?.[cid]);

            if (isVirtualSinger && selectedUnit) {
                if (selectedUnit === "none") {
                    rules.push({ unit: "any", characterId: cid, supportUnit: "none", bonusRate: characterBonus });
                } else {
                    rules.push({ unit: "any", characterId: cid, supportUnit: selectedUnit, bonusRate: characterBonus });
                    rules.push({ unit: "any", characterId: cid, supportUnit: "none", bonusRate: characterBonus });
                }
            } else {
                rules.push({ unit: "any", characterId: cid, bonusRate: characterBonus });
            }
        }
    }

    if (attr && attr !== "any") {
        rules.push({ unit: "any", attr, bonusRate: attrBonus });
    }

    return { rules };
}

export function buildDeckRecommendWasmPayload(
    args: DeckRecommendWasmArgs,
    bundle: WasmBundleInput,
): Record<string, unknown> {
    const basePayload: Record<string, unknown> = {
        mode: args.mode,
        region: bundle.region,
        masterData: bundle.masterData,
        userData: bundle.userData,
        musicMetas: bundle.musicMetas,
        musicId: args.musicId,
        difficulty: args.difficulty,
        liveType: args.liveType,
        supportCharacterId: args.supportCharacterId,
        cardConfig: args.cardConfig,
        leaderCharacter: args.leaderCharacter,
        strongestTarget: args.strongestTarget,
        characterId: args.characterId,
        eventId: args.eventId,
        minBonus: args.minBonus,
        maxBonus: args.maxBonus,
        limit: args.mode === "bonus" ? 1 : 10,
        member: 5,
        timeoutMs: 30000,
    };

    if (args.mode === "custom") {
        basePayload.customBonuses = buildCustomBonusConfig(
            args.customCharacterIds,
            args.customAttr,
            args.customCharacterBonus ?? 25,
            args.customAttrBonus ?? 25,
            args.customCharacterUnits,
            args.customUnit,
            args.customCharacterBonus ?? 25,
        );
    }

    return basePayload;
}

export function normalizeWasmDeckResults(raw: unknown): DeckResultRow[] {
    if (Array.isArray(raw)) {
        return raw as DeckResultRow[];
    }
    if (raw && typeof raw === "object" && Array.isArray((raw as { decks?: unknown[] }).decks)) {
        return (raw as { decks: DeckResultRow[] }).decks;
    }
    return [];
}
