/**
 * The seeded account a preview offers one-click sign-in to.
 *
 * `seed.ts` creates it and `preview-db.ts` points `DEMO_LOGIN_*` at it, so the
 * two cannot drift apart — which matters because nothing checks: a preview
 * whose button names an account the database does not have only fails when
 * somebody presses it.
 *
 * The password is deliberately unremarkable. It guards demo data in a database
 * that is thrown away with its branch, and it is printed in the README.
 */
export const DEMO_ACCOUNT = {
	name: "Ada Lovelace",
	email: "demo@tracker.dev",
	password: "password123",
};
