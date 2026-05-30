// Stub for the "server-only" package in test environments.
// The real module throws at import time in non-Next.js contexts; this no-op
// lets vitest import server-side modules without error.
export {};
