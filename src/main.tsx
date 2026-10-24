import { loadPlatform } from './platform.js';
export async function main(cwd = process.cwd()) { return loadPlatform(cwd); }
