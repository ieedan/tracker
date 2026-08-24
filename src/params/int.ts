import { matcher, mismatch } from "@implementjs/kit";

export default matcher((v) => {
    const parsed = Number(v);
    return isNaN(parsed) ? mismatch : parsed;
})
