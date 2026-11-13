/** Resolve after `ms` milliseconds. */
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
