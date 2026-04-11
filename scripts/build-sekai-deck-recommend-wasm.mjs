import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const nativeRoot = path.join(projectRoot, 'refer', 'sekai-deck-recommend-cpp');
const srcRoot = path.join(nativeRoot, 'src');
const jsonIncludeDir = path.join(nativeRoot, '3rdparty', 'json', 'single_include');
const outputDir = path.join(projectRoot, 'web', 'public', 'wasm', 'sekai-deck-recommend');
const outputFile = path.join(outputDir, 'sekai-deck-recommend.js');

function hasExecutable(name) {
  try {
    execFileSync(name, ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function resolveEmcc() {
  const localEmccBat = path.join(projectRoot, 'tools', 'emsdk', 'upstream', 'emscripten', 'emcc.bat');
  if (process.platform === 'win32' && fs.existsSync(localEmccBat)) {
    return {
      command: 'cmd.exe',
      prefixArgs: ['/c', localEmccBat],
    };
  }
  if (hasExecutable('emcc')) {
    return {
      command: 'emcc',
      prefixArgs: [],
    };
  }
  throw new Error('Missing `emcc`. Please install/activate Emscripten first, then rerun this script.');
}

function collectCppFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectCppFiles(fullPath));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.cpp')) {
      continue;
    }
    if (entry.name === 'sekai_deck_recommend.cpp') {
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

const emcc = resolveEmcc();

if (!fs.existsSync(jsonIncludeDir)) {
  throw new Error('Missing 3rdparty/json/single_include. Run `git submodule update --init --recursive` first.');
}

fs.mkdirSync(outputDir, { recursive: true });

const sourceFiles = collectCppFiles(srcRoot);
sourceFiles.sort();

execFileSync(
  emcc.command,
  [
    ...emcc.prefixArgs,
    ...sourceFiles,
    '-std=c++20',
    '-O3',
    '-fexceptions',
    '-I', srcRoot,
    '-I', jsonIncludeDir,
    '-s', 'WASM=1',
    '-s', 'MODULARIZE=1',
    '-s', 'EXPORT_ES6=1',
    '-s', 'ENVIRONMENT=web,worker',
    '-s', 'ALLOW_MEMORY_GROWTH=1',
    '-s', 'INITIAL_MEMORY=268435456',
    '-s', 'MAXIMUM_MEMORY=2147483648',
    '-s', 'NO_EXIT_RUNTIME=1',
    '-s', 'DISABLE_EXCEPTION_CATCHING=0',
    '-s', "EXPORTED_RUNTIME_METHODS=['ccall','UTF8ToString','HEAPU8']",
    '-s', "EXPORTED_FUNCTIONS=['_malloc','_free']",
    '-o', outputFile,
  ],
  {
    cwd: nativeRoot,
    stdio: 'inherit',
  },
);
