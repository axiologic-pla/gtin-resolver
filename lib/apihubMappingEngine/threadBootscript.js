const worker_threads = "worker_threads";
const {parentPort, isMainThread} = require(worker_threads);
const openDSUBundle = "./../../../opendsu-sdk/builds/output/openDSU.js";
require(openDSUBundle);
const gtinResolverBundle = "./../../../gtin-resolver/build/bundles/gtinResolver.js";
require(gtinResolverBundle);
let threadGroupMessages, walletSSI;
const gtinResolver = require("gtin-resolver");
let LogService = gtinResolver.loadApi("services").LogService;
const errMap = require("opendsu").loadApi("m2dsu").getErrorsMap();

if (!isMainThread) {
    parentPort.postMessage("ready");

    function updateMessagesWithError(messages, err) {
        let error = err.otherErrors && err.otherErrors.details ? err : errMap.newCustomError(errMap.errorTypes.UNKNOWN, [err])
        let messagesWithErrors = messages.map(msg => {
            return JSON.stringify({
                message: msg,
                reason: err.message,
                error: error
            });
        })
        return messagesWithErrors;
    }

    parentPort.on("message", (taskData) => {
        // parentPort.postMessage(message);
        taskData = JSON.parse(taskData);
        console.log(`[workers] node worker activated for wallet "${taskData.walletSSI}"`);
        walletSSI = taskData.walletSSI;
        const openDSU = require("opendsu");
        openDSU.loadApi("resolver").loadDSU(walletSSI, (err, wallet) => {
            if (err) {
                return parentPort.postMessage(JSON.stringify({
                    walletSSI,
                    undigestedMessages: updateMessagesWithError(taskData.messages, err)
                }));
            }

            const scAPI = openDSU.loadApi("sc");
            scAPI.setMainDSU(wallet);

            const groupMessages = taskData.messages;
            const context = taskData.messages[0].context;
            threadGroupMessages = groupMessages;

            return scAPI.getSharedEnclave(async (err, sharedEnclave) => {

                if (err) {
                    console.error("[workers] uncaughtException inside node worker", err);
                    parentPort.postMessage(JSON.stringify({
                        walletSSI,
                        undigestedMessages: updateMessagesWithError(groupMessages, err)
                    }));
                    return
                }
                const logService = new LogService();
                let undigestedMessages;
                const m2dsu = openDSU.loadAPI("m2dsu");
                let mappingEngine = m2dsu.getMappingEngine(sharedEnclave, {
                    holderInfo: context,
                    logService: logService
                });
                try {
                    undigestedMessages = await mappingEngine.digestMessages(groupMessages);
                } catch (e) {
                    return parentPort.postMessage(JSON.stringify({
                        walletSSI,
                        undigestedMessages: updateMessagesWithError(groupMessages, e)
                    }));
                }
                console.log("[MAPPING ENGINE]:Undigested messages:", undigestedMessages.length);
                parentPort.postMessage(JSON.stringify({walletSSI, undigestedMessages}));
            });
        });

    });

    process.on("uncaughtException", (error) => {
        console.error("[workers] uncaughtException inside node worker", error);
        return parentPort.postMessage(JSON.stringify({
            walletSSI,
            undigestedMessages: updateMessagesWithError(threadGroupMessages, error)
        }));
    });
}

