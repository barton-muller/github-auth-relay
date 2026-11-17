import type { Client } from './ghstore.js';
export interface DemoClient extends Client { reset(): Promise<void> }
export function createDemoClient(options?: { name?: string; folder?: string; seed?: Record<string, string> }): DemoClient;
