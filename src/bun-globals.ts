declare global {
  interface BunFile {
    text(): Promise<string>;
  }

  interface BunSpawnSyncResult {
    stdout: Uint8Array;
    stderr: Uint8Array;
    exitCode: number;
  }

  interface BunNamespace {
    file(path: string): BunFile;
    spawnSync(
      cmd: string[],
      options?: {
        stdout?: 'pipe';
        stderr?: 'pipe';
      },
    ): BunSpawnSyncResult;
  }

  const Bun: BunNamespace;
}

export {};
