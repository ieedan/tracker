import { matcher, mismatch } from "@implementjs/kit/params";

export default matcher((v) => {
    const parsed = Number(v);
    return isNaN(parsed) ? mismatch : parsed;
})
