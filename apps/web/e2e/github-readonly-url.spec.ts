import { expect, test } from "@playwright/test";
import { safeGitHubUrl } from "../src/app/github/github-readonly";

test("accepts only clean https github.com preview URLs", () => {
  const cases = [
    ["https://github.com/RLM-Company/Nexus-OS", "https://github.com/RLM-Company/Nexus-OS"],
    ["http://github.com/RLM-Company/Nexus-OS", "https://github.com/"],
    ["https://user:pass@github.com/RLM-Company/Nexus-OS", "https://github.com/"],
    ["https://github.com:444/RLM-Company/Nexus-OS", "https://github.com/"],
    ["https://github.com.evil.example/RLM-Company/Nexus-OS", "https://github.com/"],
    ["not-a-url", "https://github.com/"]
  ] as const;

  for (const [value, expected] of cases) {
    expect(safeGitHubUrl(value)).toBe(expected);
  }
});
