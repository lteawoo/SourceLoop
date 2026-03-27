import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initializeWorkspace } from "../src/core/workspace/init-workspace.js";
describe("initializeWorkspace", () => {
    it("creates the SourceLoop workspace layout and config", async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
        const result = await initializeWorkspace({
            directory: tempRoot,
            force: false
        });
        expect(result.rootDir).toBe(tempRoot);
        const configRaw = await readFile(path.join(tempRoot, ".sourceloop/config.json"), "utf8");
        const config = JSON.parse(configRaw);
        expect(config.version).toBe(1);
        expect(config.paths.sources).toBe("vault/sources");
        expect(config.paths.bundles).toBe("vault/bundles");
        expect(config.paths.runs).toBe("vault/runs");
        expect(config.paths.outputs).toBe("vault/outputs");
    });
});
//# sourceMappingURL=init-workspace.test.js.map