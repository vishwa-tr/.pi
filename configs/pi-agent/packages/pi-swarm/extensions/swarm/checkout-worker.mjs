import { inspectCheckoutSync } from "./host-approval.mjs";
import { parentPort, workerData } from "node:worker_threads";

try {
	parentPort.postMessage({ result: inspectCheckoutSync(workerData.workspace, workerData) });
} catch (error) {
	parentPort.postMessage({ error: { code: error.code, message: error.message } });
}
