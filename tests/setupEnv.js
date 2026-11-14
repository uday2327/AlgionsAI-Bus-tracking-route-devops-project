require('dotenv').config();
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error('Set TEST_DATABASE_URL to a dedicated test database before running tests.');
if (!/_test(?:\?|$)/.test(testUrl)) throw new Error('TEST_DATABASE_URL must point to a database whose name ends in _test.');
process.env.DATABASE_URL = testUrl;
