import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const indexUrl = new URL("./index.js", import.meta.url).href;
const cliPath = fileURLToPath(new URL("./cli.js", import.meta.url));

const sleep = (ms = 0) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
};

const waitFor = async (check, timeout = 5000) => {
    const start = Date.now();
    while (!check()) {
        if (Date.now() - start > timeout) {
            throw new Error("Timed out");
        }
        await sleep(20);
    }
};

const createFixture = async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "koni-"));
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

describe("cli", () => {
    let root = "";
    let tasksFile = "";

    const cli = (...args) => {
        return exec(process.execPath, [cliPath, "-f", tasksFile, ...args], { cwd: root });
    };

    before(async () => {
        root = await createFixture();
        tasksFile = path.join(root, "koni.config.js");
        await fs.writeFile(tasksFile, [
            `import { src, dest, pipeline, task, series } from ${JSON.stringify(indexUrl)};`,
            `const cwd = ${JSON.stringify(root)};`,
            `task("build", () => pipeline(src("src/**/*.txt", {cwd}), dest(cwd + "/dist")));`,
            `task("default", series("build"));`,
            `task("fail", () => { throw new Error("boom"); });`,
        ].join("\n"));
    });
    after(() => {
        return fs.rm(root, { recursive: true, force: true });
    });

    it("should run the default task when no task is given", async () => {
        const { stdout } = await cli();
        assert.match(stdout, /Finished 'default'/);
        assert.equal(await fs.readFile(path.join(root, "dist", "a.txt"), "utf8"), "a");
    });

    it("should run the given tasks in order", async () => {
        const {stdout} = await cli("build", "default");
        assert.ok(stdout.indexOf("Starting 'build'") < stdout.indexOf("Starting 'default'"));
    });

    it("should list the available tasks", async () => {
        const {stdout} = await cli("--list");
        assert.deepEqual(stdout.trim().split("\n"), ["build", "default", "fail"]);
    });

    it("should show the help", async () => {
        const {stdout} = await cli("--help");
        assert.match(stdout, /Usage:/);
    });

    it("should exit with code 1 when a task does not exist", async () => {
        await assert.rejects(cli("nope"), (error) => {
            assert.equal(error.code, 1);
            assert.match(error.stderr, /Task 'nope' not found/);
            return true;
        });
    });

    it("should exit with code 1 when a task fails", async () => {
        await assert.rejects(cli("fail"), (error) => {
            assert.equal(error.code, 1);
            assert.match(error.stderr, /boom/);
            return true;
        });
    });
});
