require('../../opendsu-sdk/builds/output/testsRuntime');
require('../../gtin-resolver/build/bundles/gtinResolver');
const testIntegration = require("../../opendsu-sdk/psknode/tests/util/tir");
const opendsu = require('opendsu');
const fs = require("fs");
const messages = require("./assets/messageTypes.json");
const gtinResolverUtils = require("../lib/utils/CommonUtils")
const dc = require("double-check");
const enclaveDB = require("loki-enclave-facade");

const {assert, createTestFolder} = dc;
const http = opendsu.loadApi("http");
const doPut = $$.promisify(http.doPut);

const domain = "default";
const endpoint1NrOfMsgs = 15;
const endpoint2NrOfMsgs = 12;

function setEndpointMessages(endpoint, nrOfMessages, message) {
    let resultArr = [];
    for (let i = 0; i < nrOfMessages; i++) {
        let clone = JSON.parse(JSON.stringify(message));
        clone.senderId = endpoint;
        clone.product.productCode = "" + Math.floor(Math.random() * 100000000000000);
        clone.messageId = "" + Math.floor(Math.random() * 10000000);
        resultArr.push(clone);
    }
    return resultArr;
}

assert.callback("ApiHub message buffering with enclave queue", async (finishTest) => {
    const utils = require("./utils");

    const endpoint1 = await utils.launchEndpoint();
    const endpoint2 = await utils.launchEndpoint();
    let mainNode = await utils.launchMainServer([
        {name: "endpoint1", url: endpoint1.url},
        {name: "endpoint2", url: endpoint2.url}
    ])

    try {
        const {subjectSSI} = await utils.prepareWallet();

        let message = messages.find(item => item.messageType === "Product");

        let testMessages = [...setEndpointMessages("endpoint1", endpoint1NrOfMsgs, message), ...setEndpointMessages("endpoint2", endpoint2NrOfMsgs, message)]

        const putResult = await $$.promisify(doPut)(`${mainNode.url}/mappingEngine/${domain}/default`, JSON.stringify(testMessages), {headers: {token: subjectSSI.getIdentifier()}});
        let queuePath = require("path").resolve(mainNode.rootFolder);
        queuePath = require("path").join(queuePath, "messageQueueDB");

        setTimeout(async () => {
            try {
                let enclaveQueue = new enclaveDB(queuePath + "/queue.db");
                let queueSize = await $$.promisify(enclaveQueue.queueSize)("", subjectSSI.getIdentifier());
                assert.equal(queueSize, endpoint1NrOfMsgs + endpoint2NrOfMsgs);
                mainNode = await $$.promisify(testIntegration.restart)();
            } catch (e) {
                throw e
            }
        }, 10000)

        let interval = setInterval(async () => {
            let enclaveQueue = new enclaveDB(queuePath + "/queue.db");
            let queueSize = await $$.promisify(enclaveQueue.queueSize)("", subjectSSI.getIdentifier());
            if (queueSize === 0) {
                clearInterval(interval);
                setTimeout(async () => {
                    let response1 = await http.fetch(`${endpoint1.url}/mappingEngine/${domain}/logs`);
                    let result1 = await response1.json();
                    assert.equal(result1.length, endpoint1NrOfMsgs);
                    let response2 = await http.fetch(`${endpoint2.url}/mappingEngine/${domain}/logs`);
                    let result2 = await response2.json();
                    assert.equal(result2.length, endpoint2NrOfMsgs);
                    finishTest();
                }, 4000)
            }
        }, 2000)

    } catch
        (e) {
        console.log("Error on put message ", e);
    }
}, 4 * 60 * 1000)
