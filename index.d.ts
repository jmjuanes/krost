export type File = {
    path: string;
    base: string;
    relative: string;
    content: any;
};

// A pipeline step that runs once for every file. It can return a file to replace
// it, `null` to drop it, or nothing to keep the (possibly mutated) file.
export type Stage = (file: File) => File | null | void | Promise<File | null | void>;

// A task: any function, sync or async, that may return a promise or a pipeline.
export type Task = () => unknown;

// A task function or the name of a registered task.
export type TaskLike = Task | string;

// A chain of stages that can be awaited. Awaiting it resolves to the final list of files.
export interface Pipeline extends PromiseLike<File[]> {
    pipe(stage: Stage): Pipeline;
}

// options used for src
export type SrcOptions = {
    cwd?: string;
};

// reads the files that match one or more glob patterns.
export const src: (patterns: string | string[], options?: SrcOptions) => Pipeline;

// creates a stage that writes each file into a directory, keeping its relative path.
export const dest: (directory: string) => Stage;

// registered tasks, by name.
export const tasks: Map<string, Task>;

// registers a task.
export const task: (name: string, fn: Task) => void;

// creates a task that runs the given tasks one after another.
export const series: (...items: TaskLike[]) => Task;

// creates a task that runs the given tasks at the same time.
export const parallel: (...items: TaskLike[]) => Task;
