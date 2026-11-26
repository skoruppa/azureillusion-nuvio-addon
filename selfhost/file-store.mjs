import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { memoryStore } from '../fonts/lib/store.js';

const SAVE_DELAY_MS = 5000;

export async function fileStore(dir) {
  const path = join(dir, 'font-store.json');
  let initial = {};
  try {
    initial = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`font store ${path} unreadable, starting empty: ${error.message}`);
  }
  const memory = memoryStore(initial);
  let timer = null;

  const save = async () => {
    timer = null;
    await mkdir(dir, { recursive: true });
    const temporary = `${path}.tmp`;
    await writeFile(temporary, JSON.stringify(memory.snapshot()));
    await rename(temporary, path);
  };

  return {
    get: (keys) => memory.get(keys),
    async put(entries) {
      await memory.put(entries);
      timer ??= setTimeout(() => save().catch((error) => console.warn(`font store save failed: ${error.message}`)), SAVE_DELAY_MS);
    },
  };
}
