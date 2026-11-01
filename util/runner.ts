import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

/** GitHub hands inputs over as `INPUT_<NAME>`, uppercased, with hyphens kept. */
export const input = (name: string): string => process.env[`INPUT_${name.toUpperCase()}`]?.trim() ?? "";

const delimited = (name: string, value: string): string => {
  const delimiter = `withctx_${randomUUID()}`;
  return `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
};

export function setOutput(name: string, value: string): void {
  const file = process.env.GITHUB_OUTPUT;
  if (file) {
    appendFileSync(file, delimited(name, value));
  }
}

export function addSummary(markdown: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) {
    appendFileSync(file, `${markdown}\n`);
  }
}

/** Fails the step without a stack trace, which is all a workflow reader would see otherwise. */
export function failStep(message: string): void {
  console.log(`::error::${message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")}`);
  process.exitCode = 1;
}
