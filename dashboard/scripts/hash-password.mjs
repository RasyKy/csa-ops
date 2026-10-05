// Prints DASHBOARD_PASSWORD_HASH for the given password: "<salt_hex>:<hash_hex>"
// (scrypt N=16384 r=8 p=1, 32-byte key, 16-byte random salt). Value only, so it
// can be pasted into an environment variable.
//
//   node scripts/hash-password.mjs "your password"
import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2];
if (typeof password !== "string" || password.length === 0 || password.length > 200) {
  console.error('usage: node scripts/hash-password.mjs "<password>"  (1 to 200 characters)');
  process.exit(1);
}

const salt = randomBytes(16);
const hash = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
console.log(`${salt.toString("hex")}:${hash.toString("hex")}`);
