"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDbPool = createDbPool;
const pg_1 = require("pg");
async function createDbPool(config) {
    const pool = new pg_1.Pool(config);
    await pool.query('SELECT 1');
    return pool;
}
//# sourceMappingURL=db.js.map