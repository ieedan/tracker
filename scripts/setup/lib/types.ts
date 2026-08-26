/** Shared shapes for the setup steps. */

export type SetupMode = "dev" | "preview" | "prod";

export type SetupOptions = {
	/** Ignore any half-finished run and start from scratch. */
	fresh: boolean;
	cwd: string;
};

/**
 * Everything a run has collected so far. Persisted between steps so an
 * interrupted run can be picked up where it stopped — and so a later step
 * knows what an earlier one did rather than asking again.
 */
export type SetupData = {
	/** The environment being assembled, key by key. */
	values: Record<string, string>;
	/** Decisions worth remembering: which database, whether storage is running. */
	choices: {
		/** `local` writes a SQLite file; `turso` points at a hosted database. */
		database?: "local" | "turso";
		/** Name of the Turso database this run created or reused. */
		tursoDatabase?: string;
		/** Whether MinIO was started for this run. */
		storageRunning?: boolean;
		/** Whether the environment was pushed to Vercel. */
		pushedToVercel?: boolean;
		/** Whether migrations have been applied to the database above. */
		migrated?: boolean;
		/** Whether the demo workspace was seeded. */
		seeded?: boolean;
		/** The file the environment was written to, once it has been. */
		wrote?: string;
	};
};

export type StepContext = {
	options: SetupOptions;
	/** Every `.env*` file in the project, parsed — the previous run's answers. */
	env: Record<string, Record<string, string>> | null;
	mode: SetupMode;
	data: SetupData;
};

export type Step = {
	name: string;
	run: (ctx: StepContext) => Promise<void>;
};

/** The values of whichever `.env` file this mode owns, or `{}`. */
export function existingEnv(ctx: StepContext, file: string): Record<string, string> {
	return ctx.env?.[file] ?? {};
}

export function filled(value: string | undefined): value is string {
	return value !== undefined && value !== "";
}

/** Trims a trailing slash so a URL can be concatenated with a path. */
export function origin(url: string): string {
	return url.replace(/\/+$/, "");
}
