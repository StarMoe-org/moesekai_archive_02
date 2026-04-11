type EmscriptenModule = {
    HEAPU8: Uint8Array;
    ccall: (
        ident: string,
        returnType: string | null,
        argTypes: string[],
        args: unknown[],
    ) => unknown;
    _malloc: (size: number) => number;
    _free: (ptr: number) => void;
};

const WASM_VERSION = "sekai_deck_recommend_wasm_v1";
let modulePromise: Promise<EmscriptenModule> | null = null;

function toAbsolutePublicUrl(path: string): string {
    if (/^https?:\/\//.test(path)) {
        return path;
    }

    const origin = globalThis.location?.origin;
    if (origin && origin !== "null") {
        return new URL(path, `${origin}/`).toString();
    }

    return path;
}

async function loadModule(): Promise<EmscriptenModule> {
    if (!modulePromise) {
        modulePromise = (async () => {
            const jsUrl = toAbsolutePublicUrl(`/wasm/sekai-deck-recommend/sekai-deck-recommend.js?v=${WASM_VERSION}`);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const mod = await (Function("url", "return import(url)")(jsUrl) as Promise<any>);
            const factory = mod.default as (options: { locateFile: (file: string) => string }) => Promise<EmscriptenModule>;
            return await factory({
                locateFile: (file: string) => toAbsolutePublicUrl(`/wasm/sekai-deck-recommend/${file}?v=${WASM_VERSION}`),
            });
        })();
    }
    return modulePromise;
}

export class SekaiDeckRecommendWasm {
    private module: EmscriptenModule | null = null;

    async init(): Promise<void> {
        if (this.module) {
            return;
        }
        this.module = await loadModule();
    }

    runRecommend<T>(payload: unknown): T {
        const wasmModule = this.assertReady();
        const encoded = new TextEncoder().encode(JSON.stringify(payload));
        const ptr = wasmModule._malloc(encoded.length + 1);
        try {
            wasmModule.HEAPU8.set(encoded, ptr);
            wasmModule.HEAPU8[ptr + encoded.length] = 0;
            const raw = String(wasmModule.ccall("run_recommend_json", "string", ["number", "number"], [ptr, encoded.length]) ?? "");
            if (!raw) {
                throw new Error(this.getLastError() || "WASM deck recommend returned empty result.");
            }
            return JSON.parse(raw) as T;
        } finally {
            wasmModule._free(ptr);
        }
    }

    getLastError(): string {
        return String(this.assertReady().ccall("get_last_error", "string", [], []) ?? "");
    }

    private assertReady(): EmscriptenModule {
        if (!this.module) {
            throw new Error("SekaiDeckRecommendWasm is not initialized.");
        }
        return this.module;
    }
}
