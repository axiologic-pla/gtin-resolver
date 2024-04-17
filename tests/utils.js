const testIntegration = require("../../opendsu-sdk/psknode/tests/util/tir");
require('../../opendsu-sdk/builds/output/testsRuntime');
require('../../gtin-resolver/build/bundles/gtinResolver');
const domain = "default";
const dc = require("double-check");
const {createTestFolder} = dc;
const resolver = require("opendsu").loadApi("resolver");
const crypto = require("opendsu").loadApi("crypto");

function setEndpointMessages(endpoint, nrOfMessages, message) {
    let resultArr = [];
    for (let i = 0; i < nrOfMessages; i++) {
        let clone = JSON.parse(JSON.stringify(message));
        clone.senderId = endpoint;
        clone.messageId = "" + Math.floor(Math.random() * 10000000);
        if (message.messageType === "Product") {
            clone.product.productCode = "" + Math.floor(Math.random() * 100000000000000);
        }
        if (message.messageType === "Batch") {
            clone.batch.batch = "" + Math.floor(Math.random() * 100000000000000);
        }
        resultArr.push(clone);
    }
    return resultArr;
}

async function launchMainServer(endpointsURL) {
    let apihubConfig = {
        domains: [{
            name: domain,
            config: {
                "anchoring": {
                    "type": "FS",
                    "option": {
                        "enableBricksLedger": false
                    },
                    "commands": {
                        "addAnchor": "anchor"
                    }
                }
            }
        }],
        serverConfig: {
            "activeComponents": [
                "bdns",
                "bricksLedger",
                "bricksFabric",
                "bricking",
                "anchoring",
                "epi-mapping-engine",
                "epi-mapping-engine-results"
            ],
            "componentsConfig": {
                "epi-mapping-engine": {
                    "module": require("path").join(__dirname, "../"),
                    "function": "getEPIMappingEngineForAPIHUB"
                },
                "epi-mapping-engine-results": {
                    "module": require("path").join(__dirname, "../"),
                    "function": "getEPIMappingEngineMessageResults"
                }
            },
        }
    };
    let configDomain = apihubConfig.domains.find(item => item.name === domain);
    configDomain.config.messagesEndPoints = [];
    endpointsURL.forEach(endpoint => {
        configDomain.config.messagesEndPoints.push({
            "endPointId": endpoint.name,
            "endPointURL": `${endpoint.url}/mappingEngine/${domain}/default/saveResult`
        })
    })
    apihubConfig.rootFolder = await $$.promisify(createTestFolder)('enclaveBuffering' + Math.floor(Math.random() * 10000));
    return await $$.promisify(testIntegration.launchConfigurableApiHubTestNode)(apihubConfig);

}

async function launchEndpoint() {
    return new Promise((resolve, reject) => {
        const childProcess = require("child_process");
        const childEndpoint = childProcess.fork("./apihubQueueBufferingChild.js", [], {stdio: [0, 1, 2, "ipc"]});
        childEndpoint.on("error", reject)
        childEndpoint.on("message", resolve);
    })
}

async function prepareWallet() {
    const issuerDSU = await $$.promisify(resolver.createSeedDSU)(domain, {});
    const issuerSSI = await $$.promisify(issuerDSU.getKeySSIAsString)();
    const activeWallet = await $$.promisify(resolver.createSeedDSU)(domain, {});
    const subjectSSI = await $$.promisify(activeWallet.getKeySSIAsObject)();
    const derivedSubjectSSI = await $$.promisify(subjectSSI.derive)();
    const token = await $$.promisify(crypto.createCredential)(issuerSSI, derivedSubjectSSI)
    await $$.promisify(activeWallet.writeFile)("/myKeys/credential.json", JSON.stringify({credential: token}))

    const openDSU = require("opendsu");
    const scAPI = openDSU.loadAPI("sc");
    const enclaveAPI = openDSU.loadAPI("enclave");
    const dbApi = require("opendsu").loadApi("db");

    const vaultDomain = await $$.promisify(scAPI.getVaultDomain)();
    const dsu = await $$.promisify(resolver.createSeedDSU)(vaultDomain, {});
    const keySSI = await $$.promisify(dsu.getKeySSIAsString)();
    const enclave = enclaveAPI.initialiseWalletDBEnclave(keySSI);
    const enclaveDID = await $$.promisify(enclave.getDID)();
    const enclaveKeySSI = await $$.promisify(enclave.getKeySSI)();
    let env = {};

    env[openDSU.constants.SHARED_ENCLAVE.TYPE] = "WalletDBEnclave";
    env[openDSU.constants.SHARED_ENCLAVE.DID] = enclaveDID;
    env[openDSU.constants.SHARED_ENCLAVE.KEY_SSI] = enclaveKeySSI;
    env["epiProtocolVersion"] = 1;
    await $$.promisify(activeWallet.writeFile)("/environment.json", JSON.stringify(env));

    const mainDSU = await $$.promisify(scAPI.getMainDSU)();
    await $$.promisify(mainDSU.writeFile)("/environment.json", JSON.stringify(env));
    const envFile = await $$.promisify(mainDSU.readFile)("/environment.json");
    scAPI.refreshSecurityContext();
    const enclaveDB = await $$.promisify(dbApi.getSharedEnclaveDB)();
    return {
        enclaveDB,
        subjectSSI
    }
}

module.exports = {
    setEndpointMessages,
    launchMainServer,
    launchEndpoint,
    prepareWallet
}
