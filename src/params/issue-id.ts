import { matcher, mismatch } from "@implementjs/kit";

export default matcher((v) => {
	const match = /^([A-Z]+)-(\d+)$/.exec(v);
	if (!match) return mismatch;

	const [, team, id] = match;
	if (!team || !id) return mismatch;

	return { og: v, team, id: Number(id) };
});
