export function writeJsonOutput(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function writeTextOutput(message: string): void {
  process.stdout.write(`${message}\n`);
}
