// Runs before every test file: tests never call the network, so the Sorani proofreader (a real outside service) is off unless a
// test (tests/ai/proofread.test.ts) switches it on with its own stubbed fetch.
process.env.PROOFREAD_ENABLED = "0";
