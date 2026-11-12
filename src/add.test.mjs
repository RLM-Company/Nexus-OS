import assert from 'node:assert/strict';
import { add } from './add.mjs';
assert.equal(add(2, 3), 5);
assert.equal(add(-2, 1), -1);
