/// <reference types="node" />

import { Transform, Writable } from "node:stream";

export { pipeline } from "node:stream/promises";

// A file object that travels through a pipeline.
export type File = {
    // Absolute path of the file in the source tree.
    path: string;
    // Absolute path of the directory the pattern is relative to.
    base: string;
    // Path of the file relative to `base`. Change it to rename or move the file.
    relative: string;
    // Content of the file.
    content: Buffer | string;
};

// A function that runs for every file. It can return a file to replace it,
// `null` to drop it, or nothing to keep the (possibly mutated) file.
export type Handler = (file: File) => File | null | void | Promise<File | null | void>;

// A function that receives all the files at once, as an array, and returns the new array.
// If it returns nothing, the files are kept.
export type Batch = (files: File[]) => File[] | void | Promise<File[] | void>;

// A task: any function, sync or async, that may return a promise or a stream.
export type Task = () => unknown;

// A task function or the name of a registered task.
export type TaskLike = Task | string;

// Registered tasks, by name.
export const tasks: Map<string, Task>;

export type SrcOptions = {
    cwd?: string;
};

// Creates a stream with the files that match one or more glob patterns.
// The paths are listed first, but the content of each file is read only when the stream needs it.
export const src: (patterns: string | string[], options?: SrcOptions) => Transform;

// Creates a stream that runs a function for every file, one at a time.
export const each: (fn: Handler) => Transform;

// Creates a stream that waits for all the files, and gives them to a function as an array.
// All the files are in memory at once, so use it only when you need to see them all.
export const all: (fn: Batch) => Transform;

// Creates a stream that writes each file into a directory, keeping its relative path.
export const dest: (directory: string) => Writable;

// Registers a task. If the task returns a stream, it finishes when the stream does.
export const task: (name: string, fn: Task) => void;

// Creates a task that runs the given tasks one after another.
export const series: (...items: TaskLike[]) => Task;

// Creates a task that runs the given tasks at the same time.
export const parallel: (...items: TaskLike[]) => Task;
