#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { tasks, series } from "./index.js";

const USAGE = `Usage: mirko [options] [task...]

Runs the tasks registered in a mirko.config.js file, one after another.
If no task is given, the task named 'default' is run.

Options:
  -f, --file <path>   Tasks file to load (default: tasks.js)
  -l, --list          List the available tasks
  -h, --help          Show this help`;

// Loads the tasks file and runs the requested tasks.
// @returns {Promise<void>}
const main = async () => {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            file: {
                type: "string",
                short: "f",
                default: "mirko.config.js",
            },
            list: {
                type: "boolean",
                short: "l",
                default: false,
            },
            help: {
                type: "boolean",
                short: "h",
                default: false,
            },
        },
    });
    if (values.help) {
        return console.log(USAGE);
    }
    await import(pathToFileURL(path.resolve(values.file)).href);
    if (values.list) {
        return console.log([...tasks.keys()].join("\n"));
    }
    await series(...(positionals.length > 0 ? positionals : ["default"]))();
};

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
