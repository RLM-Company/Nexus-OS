import { expect, test } from "@playwright/test";
import { safeGitHubUrl } from "../src/app/github/github-readonly";

test("accepts only clean https github.com preview URLs", () => {
  expect(safeGitHubUrl("https://github.com/RLM-Company/Nexus-OS")).toBe(
    "https://github.com/RLM-Company/Nexus-OS"
  );
  expect(safeGitHubUrl("http://github.com/RLM-Company/Nexus-OS")).toBe("https://github.com/");
  expect(safeGitHubUrl("https://user:pass@github.com/RLM-Company/Nexus-OS")).toBe(
    "https://github.com/"
  );
  expect(safeGitHubUrl("https://github.com:444/RLM-Company/Nexus-OS")).toBe(
    "https://github.com/"
  );
  expect(safeGitHubUrl("https://github.com.evil.example/RLM-Company/Nexus-OS")).toBe(
    "https://github.com/"
  );
  expect(safeGitHubUrl("not-a-url")).toBe("https://github.com/");
});
