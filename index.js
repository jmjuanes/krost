import fs from "node:fs";
import path from "node:path";
import { Readable, Transform, Writable, Stream } from "node:stream";
import { finished } from "node:stream/promises";
import { callbackify } from "node:util";

export { pipeline } from "node:stream/promises";

// @description registered tasks by name
// @type {Map<string, Task>}
export const tasks = new Map();

// @description gets the static directory of a glob pattern.
// @param {string} pattern
// @param {string} cwd
// @returns {string} Absolute path.
const getBase = (pattern, cwd) => {
    const index = pattern.search(/[*?[{]/);
    const prefix = index < 0 ? pattern : pattern.slice(0, index);
    const directory = (index >= 0 && prefix.endsWith("/")) ? prefix : path.dirname(prefix);
    return path.resolve(cwd, directory);
};

// @description runs a task function or a registered task by name.
// @param {TaskLike} item
// @returns {Promise<void>}
const run = async (item) => {
    if (typeof item === "string") {
        if (!tasks.has(item)) {
            throw new Error(`Task '${item}' not found`);
        }
        item = tasks.get(item);
    }
    await item();
};

// @description reads the content of a file found by `src`. Directories are dropped.
// @param {object} entry
// @returns {Promise<File|null>}
const load = async (entry) => {
    if (!(await fs.promises.stat(entry.path)).isFile()) {
        return null;
    }
    return {
        ...entry,
        relative: path.relative(entry.base, entry.path),
        content: await fs.promises.readFile(entry.path),
    };
};

// @description creates a stream with the files that match one or more glob patterns.
// The paths are listed first, but the content of each file is read only when the stream needs it.
// @param {string|string[]} patterns
// @param {object} [options]
// @param {string} [options.cwd="."] Directory used to resolve the patterns.
// @returns {Transform}
export const src = (patterns, options = {}) => {
    const cwd = path.resolve(options.cwd || ".");
    const entries = [patterns].flat().flatMap(pattern => {
        const base = getBase(pattern, cwd);
        return fs.globSync(pattern, { cwd }).map(match => {
            return {
                path: path.resolve(cwd, match),
                base: base,
            };
        });
    });
    return Readable.from(entries).pipe(each(load));
};

// @description creates a stream that runs a function for every file, one at a time.
// @param {Handler} fn
// @returns {Transform}
export const each = fn => {
    return new Transform({
        objectMode: true,
        transform: callbackify(async file => {
            const result = await fn(file);
            return result === undefined ? file : result;
        }),
    });
};

// @description creates a stream that waits for all the files, and gives them to a function as an array.
// All the files are in memory at once, so use it only when you need to see them all (for example, to concatenate).
// @param {Batch} fn
// @returns {Transform}
export const all = fn => {
    const files = [];
    const stream = new Transform({
        objectMode: true,
        transform: (file, encoding, callback) => {
            files.push(file);
            callback();
        },
        flush: callbackify(async () => {
            for (const file of (await fn(files)) ?? files) {
                stream.push(file);
            }
        }),
    });
    return stream;
};

// Creates a stream that writes each file into a directory, keeping its relative path.
// @param {string} directory
// @returns {Writable}
export const dest = (directory = "./") => {
    const destination = path.resolve(directory);
    return new Writable({
        objectMode: true,
        write: callbackify(async (file) => {
            const target = path.resolve(destination, file.relative);
            await fs.promises.mkdir(path.dirname(target), {recursive: true});
            await fs.promises.writeFile(target, file.content);
        }),
    });
};

// @description registers a task. If the task returns a stream, it finishes when the stream does.
// @param {string} name
// @param {Task} fn
export const task = (name, fn) => {
    tasks.set(name, async () => {
        const start = performance.now();
        console.log(`Starting '${name}'...`);
        const result = await fn();
        if (result instanceof Stream) {
            await finished(result);
        }
        console.log(`Finished '${name}' after ${Math.round(performance.now() - start)} ms`);
    });
};

// @description creates a task that runs the given tasks one after another.
// @param {...TaskLike} items
// @returns {Task}
export const series = (...items) => {
    return async () => {
        for (const item of items) {
            await run(item);
        }
    };
};

// @description creates a task that runs the given tasks at the same time.
// @param {...TaskLike} items
// @returns {Task}
export const parallel = (...items) => {
    return async () => {
        await Promise.all(items.map(run));
    };
};
