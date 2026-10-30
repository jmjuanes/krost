import fs from "node:fs/promises";
import path from "node:path";

/**
 * Registered tasks, by name.
 * @type {Map<string, Task>}
 */
export const tasks = new Map();

/**
 * Gets the static directory of a glob pattern.
 * @param {string} pattern
 * @param {string} cwd
 * @returns {string} Absolute path.
 */
const getBase = (pattern, cwd) => {
    const index = pattern.search(/[*?[{]/);
    const prefix = index < 0 ? pattern : pattern.slice(0, index);
    const directory = index >= 0 && prefix.endsWith("/") ? prefix : path.dirname(prefix);
    return path.resolve(cwd, directory);
};

/**
 * Applies a stage to every file, in parallel.
 * @param {File[]} files
 * @param {Stage} stage
 * @returns {Promise<File[]>}
 */
const apply = async (files, stage) => {
    const results = await Promise.all(files.map(async file => {
        const result = await stage(file);
        return result === undefined ? file : result;
    }));
    return results.filter(file => file !== null);
};

/**
 * Creates an awaitable pipeline from a promise of files.
 * @param {Promise<File[]>} promise
 * @returns {Pipeline}
 */
const createPipeline = promise => {
    return {
        pipe: stage => {
            return createPipeline(promise.then(files => apply(files, stage)));
        },
        then: (resolve, reject) => {
            return promise.then(resolve, reject);
        },
    };
};

/**
 * Runs a task function or a registered task by name.
 * @param {TaskLike} item
 * @returns {Promise<void>}
 */
const run = async item => {
    if (typeof item === "string") {
        if (!tasks.has(item)) {
            throw new Error(`Task '${item}' not found`);
        }
        item = tasks.get(item);
    }
    await item();
};

/**
 * Reads the files that match one or more glob patterns.
 * @param {string|string[]} patterns
 * @param {object} [options]
 * @param {string} [options.cwd="."] Directory used to resolve the patterns.
 * @returns {Pipeline}
 */
export const src = (patterns, options = {}) => {
    const cwd = path.resolve(options.cwd || ".");
    const read = async () => {
        const files = [];
        for (const pattern of [patterns].flat()) {
            const base = getBase(pattern, cwd);
            for await (const match of fs.glob(pattern, {cwd})) {
                const filePath = path.resolve(cwd, match);
                if ((await fs.stat(filePath)).isFile()) {
                    files.push({
                        path: filePath,
                        base: base,
                        relative: path.relative(base, filePath),
                        content: await fs.readFile(filePath),
                    });
                }
            }
        }
        return files;
    };
    return createPipeline(read());
};

/**
 * Creates a stage that writes each file into a directory, keeping its relative path.
 * @param {string} directory
 * @returns {Stage}
 */
export const dest = (directory = ".") => {
    return async file => {
        const target = path.resolve(directory, file.relative);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, file.content);
    };
};

/**
 * Registers a task.
 * @param {string} name
 * @param {Task} fn
 */
export const task = (name, fn) => {
    tasks.set(name, async () => {
        const start = performance.now();
        console.log(`Starting '${name}'...`);
        await fn();
        console.log(`Finished '${name}' after ${Math.round(performance.now() - start)} ms`);
    });
};

/**
 * Creates a task that runs the given tasks one after another.
 * @param {...TaskLike} items
 * @returns {Task}
 */
export const series = (...items) => {
    return async () => {
        for (const item of items) {
            await run(item);
        }
    };
};

/**
 * Creates a task that runs the given tasks at the same time.
 * @param {...TaskLike} items
 * @returns {Task}
 */
export const parallel = (...items) => {
    return async () => {
        await Promise.all(items.map(run));
    };
};
