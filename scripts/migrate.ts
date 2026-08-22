import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
	console.error("DATABASE_URL is not set — is there a .env? (copy .env.example)");
	process.exit(1);
}

/**
 * A container that just reported healthy can still refuse the first connection
 * while it finishes coming up, so the first attempt is not treated as failure.
 */
const ATTEMPTS = 15;
const pool = new Pool({ connectionString: url });

try {
	for (let attempt = 1; ; attempt += 1) {
		try {
			await pool.query("select 1");
			break;
		} catch (thrown) {
			if (attempt === ATTEMPTS) throw thrown;
			if (attempt === 1) process.stdout.write("waiting for postgres");
			process.stdout.write(".");
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	}

	await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
	console.log("migrations up to date");
} finally {
	await pool.end();
}
