import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { src, dest, each, all, pipeline, task, series, parallel, tasks } from "./index.js";

const sleep = (ms = 0) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
};

// Runs a pipeline and collects the files that come out of it.
// @param {...import("node:stream").Stream} streams
// @returns {Promise<object[]>}
const collect = async (...streams) => {
    const files = [];
    await pipeline(...streams, new Writable({
        objectMode: true,
        write: (file, encoding, callback) => {
            files.push(file);
            callback();
        },
    }));
    return files;
};

// Creates a temporary directory with some source files.
// @returns {Promise<string>} Path of the directory.
const createFixture = async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mirko-"));
    const files = {
        "src/a.txt": "a",
        "src/sub/b.txt": "b",
        "src/c.md": "c",
    };
    for (const [name, content] of Object.entries(files)) {
        await fs.mkdir(path.dirname(path.join(root, name)), {recursive: true});
        await fs.writeFile(path.join(root, name), content);
    }
    return root;
};

describe("src", () => {
    let root = "";
    before(async () => {
        root = await createFixture();
    });
    after(() => fs.rm(root, {recursive: true, force: true}));

    it("should stream the files that match a glob", async () => {
        const files = await collect(src("src/**/*.txt", {cwd: root}));
        assert.deepEqual(files.map((file) => file.relative).sort(), ["a.txt", path.join("sub", "b.txt")]);
        assert.equal(files[0].base, path.join(root, "src"));
        assert.ok(path.isAbsolute(files[0].path));
        assert.ok(Buffer.isBuffer(files[0].content));
    });

    it("should be an async iterable", async () => {
        const files = await Array.fromAsync(src("src/**/*.txt", {cwd: root}));
        assert.equal(files.length, 2);
    });

    it("should ignore directories", async () => {
        const files = await collect(src("src/**", {cwd: root}));
        assert.equal(files.length, 3);
    });

    it("should keep the order of the patterns", async () => {
        const files = await collect(src(["src/c.md", "src/a.txt"], {cwd: root}));
        assert.deepEqual(files.map((file) => file.relative), ["c.md", "a.txt"]);
    });

    it("should use the directory of a file path as base", async () => {
        const [file] = await collect(src("src/a.txt", {cwd: root}));
        assert.equal(file.base, path.join(root, "src"));
        assert.equal(file.relative, "a.txt");
        assert.equal(file.content.toString(), "a");
    });

    it("should stream nothing when no file matches", async () => {
        assert.deepEqual(await collect(src("src/**/*.css", {cwd: root})), []);
    });
});

describe("each", () => {
    let root = "";
    before(async () => {
        root = await createFixture();
    });
    after(() => fs.rm(root, {recursive: true, force: true}));

    it("should run the function for every file", async () => {
        const seen = [];
        await collect(src("src/**/*.*", {cwd: root}), each((file) => {
            seen.push(file.relative);
        }));
        assert.equal(seen.length, 3);
    });

    it("should keep the file when the function returns nothing", async () => {
        const files = await collect(src("src/a.txt", {cwd: root}), each((file) => {
            file.content = "changed";
        }));
        assert.equal(files.length, 1);
        assert.equal(files[0].content, "changed");
    });

    it("should replace the file when the function returns a file", async () => {
        const files = await collect(src("src/a.txt", {cwd: root}), each((file) => ({...file, relative: "new.txt"})));
        assert.equal(files[0].relative, "new.txt");
    });

    it("should drop the file when the function returns null", async () => {
        const files = await collect(src("src/**/*.*", {cwd: root}), each((file) => {
            return file.relative.endsWith(".md") ? null : file;
        }));
        assert.equal(files.length, 2);
        assert.ok(files.every((file) => !file.relative.endsWith(".md")));
    });

    it("should support async functions", async () => {
        const files = await collect(src("src/a.txt", {cwd: root}), each(async (file) => {
            await sleep(10);
            file.content = "async";
        }));
        assert.equal(files[0].content, "async");
    });

    it("should keep the order of the files", async () => {
        const files = await collect(src(["src/a.txt", "src/c.md", "src/sub/b.txt"], {cwd: root}), each(async (file) => {
            await sleep(file.relative === "a.txt" ? 40 : 0);
        }));
        assert.deepEqual(files.map((file) => file.relative), ["a.txt", "c.md", "b.txt"]);
    });

    it("should run the stages in order", async () => {
        const calls = [];
        await collect(
            src("src/a.txt", {cwd: root}),
            each(() => {
                calls.push(1);
            }),
            each(() => {
                calls.push(2);
            }),
        );
        assert.deepEqual(calls, [1, 2]);
    });

    it("should reject the pipeline when the function fails", async () => {
        await assert.rejects(collect(src("src/**/*.*", {cwd: root}), each(() => {
            throw new Error("boom");
        })), {message: "boom"});
    });

    it("should pull the files as they are needed", async () => {
        const log = [];
        await collect(
            src("src/**/*.*", {cwd: root}),
            each(() => {
                log.push("each");
            }),
        );
        assert.equal(log.length, 3);
    });
});

describe("all", () => {
    let root = "";
    before(async () => {
        root = await createFixture();
    });
    after(() => fs.rm(root, {recursive: true, force: true}));

    it("should give the function all the files at once", async () => {
        let calls = 0;
        const files = await collect(src("src/**/*.*", {cwd: root}), all((files) => {
            calls++;
            assert.equal(files.length, 3);
            return [files[0]];
        }));
        assert.equal(calls, 1);
        assert.equal(files.length, 1);
    });

    it("should keep the files when the function returns nothing", async () => {
        const files = await collect(src("src/**/*.*", {cwd: root}), all((files) => {
            files[0].content = "changed";
        }));
        assert.equal(files.length, 3);
        assert.equal(files[0].content, "changed");
    });

    it("should support async functions", async () => {
        const files = await collect(src("src/**/*.*", {cwd: root}), all(async () => {
            await sleep(10);
            return [];
        }));
        assert.deepEqual(files, []);
    });

    it("should combine with stages that work file by file", async () => {
        const [file] = await collect(
            src(["src/a.txt", "src/c.md"], {cwd: root}),
            each((file) => {
                file.content = file.content.toString().toUpperCase();
            }),
            all((files) => [{...files[0], relative: "all.txt", content: files.map((file) => file.content).join("+")}]),
        );
        assert.equal(file.relative, "all.txt");
        assert.equal(file.content, "A+C");
    });

    it("should reject the pipeline when the function fails", async () => {
        await assert.rejects(collect(src("src/**/*.*", {cwd: root}), all(() => {
            throw new Error("boom");
        })), {message: "boom"});
    });
});

describe("dest", () => {
    let root = "";
    before(async () => {
        root = await createFixture();
    });
    after(() => fs.rm(root, {recursive: true, force: true}));

    it("should write the files keeping their relative path", async () => {
        const out = path.join(root, "out-relative");
        await pipeline(src("src/**/*.txt", {cwd: root}), dest(out));
        assert.equal(await fs.readFile(path.join(out, "a.txt"), "utf8"), "a");
        assert.equal(await fs.readFile(path.join(out, "sub", "b.txt"), "utf8"), "b");
    });

    it("should write the files with the changes made by previous stages", async () => {
        const out = path.join(root, "out-renamed");
        await pipeline(
            src("src/a.txt", {cwd: root}),
            each((file) => {
                file.relative = path.join("nested", "renamed.txt");
                file.content = "changed";
            }),
            dest(out),
        );
        assert.equal(await fs.readFile(path.join(out, "nested", "renamed.txt"), "utf8"), "changed");
    });
});

describe("tasks", () => {
    before(() => {
        mock.method(console, "log", () => {});
    });
    after(() => mock.restoreAll());

    it("should register a task by name", () => {
        task("registered", () => {});
        assert.ok(tasks.has("registered"));
    });

    it("should run the tasks of a series one after another", async () => {
        const calls = [];
        task("series-first", async () => {
            await sleep(20);
            calls.push("first");
        });
        task("series-second", () => {
            calls.push("second");
        });
        await series("series-first", () => calls.push("function"), "series-second")();
        assert.deepEqual(calls, ["first", "function", "second"]);
    });

    it("should stop a series when a task fails", async () => {
        const calls = [];
        const fail = () => {
            throw new Error("boom");
        };
        await assert.rejects(series(fail, () => calls.push("second"))(), {message: "boom"});
        assert.deepEqual(calls, []);
    });

    it("should run the tasks of a parallel at the same time", async () => {
        const calls = [];
        const create = (name, ms) => async () => {
            calls.push(`${name}:start`);
            await sleep(ms);
            calls.push(`${name}:end`);
        };
        await parallel(create("a", 40), create("b", 10))();
        assert.deepEqual(calls, ["a:start", "b:start", "b:end", "a:end"]);
    });

    it("should resolve task names when the task runs", async () => {
        const calls = [];
        const lazy = series("lazy-task");
        task("lazy-task", () => {
            calls.push("lazy");
        });
        await lazy();
        assert.deepEqual(calls, ["lazy"]);
    });

    it("should reject when a task does not exist", async () => {
        await assert.rejects(series("missing-task")(), {message: "Task 'missing-task' not found"});
    });

    it("should wait for the promise returned by a task", async () => {
        const root = await createFixture();
        try {
            task("promise-task", () => pipeline(src("src/a.txt", {cwd: root}), dest(path.join(root, "out"))));
            await series("promise-task")();
            assert.equal(await fs.readFile(path.join(root, "out", "a.txt"), "utf8"), "a");
        }
        finally {
            await fs.rm(root, {recursive: true, force: true});
        }
    });

    it("should wait for the stream returned by a task", async () => {
        const root = await createFixture();
        try {
            task("stream-task", () => src("src/**/*.txt", {cwd: root}).pipe(dest(path.join(root, "out"))));
            await series("stream-task")();
            assert.equal(await fs.readFile(path.join(root, "out", "sub", "b.txt"), "utf8"), "b");
        }
        finally {
            await fs.rm(root, {recursive: true, force: true});
        }
    });
});
