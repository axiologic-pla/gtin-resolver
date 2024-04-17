require("../../opendsu-sdk/builds/output/testsRuntime");
require("../../gtin-resolver/build/bundles/gtinResolver");

const tir = require("../../opendsu-sdk/psknode/tests/util/tir");
const dc = require('double-check');
const fs = require("fs");
const path = require("path");

const assert = dc.assert;
const DOMAIN = "default";
const gtin = "07612791468124";
const batchId = "S0001";
let productGtinSSI = require("../lib/GTIN_SSI").createGTIN_SSI(DOMAIN, DOMAIN, gtin);
let batchGtinSSI = require("../lib/GTIN_SSI").createGTIN_SSI(DOMAIN, DOMAIN, gtin, batchId);
const openDSU = require("opendsu");
const resolver = openDSU.loadApi("resolver");

function buildProductMessage() {
    return JSON.parse(JSON.stringify({
        "messageType": "Product",
        "messageTypeVersion": 1,
        "senderId": "NOVARTIS_P75_010",
        "receiverId": "ePI_DSU_NOVARTIS",
        "messageId": "00012856374589",
        "messageDateTime": "2021-04-27T10:12:12CET",
        "product": {
            "productCode": gtin,
            "internalMaterialCode": "100200",
            "inventedName": "Ritalin",
            "nameMedicinalProduct": "Ritalin LA HGC 40mg 1x30",
            "strength": "40mg",
            "flagEnableAdverseEventReporting": false,
            "adverseEventReportingURL": "",
            "flagEnableACFProductCheck": false,
            "acfProductCheckURL": "",
            "flagDisplayEPI_BatchRecalled": false,
            "flagDisplayEPI_SNRecalled": true,
            "flagDisplayEPI_SNDecommissioned": true,
            "flagDisplayEPI_SNUnknown": true,
            "flagDisplayEPI_EXPIncorrect": true,
            "flagDisplayEPI_BatchExpired": true,
            "patientSpecificLeaflet": "",
            "healthcarePractitionerInfo": "",
            "markets": [
                {
                    "marketId": "DE",
                    "nationalCode": "1234567",
                    "mahName": "Novartis",
                    "legalEntityName": "Novartis Deutschland AG"
                },
                {
                    "marketId": "AT",
                    "nationalCode": "23456",
                    "mahName": "Novartis",
                    "legalEntityName": "Novartis Österreich AG"
                }
            ]
        }
    }));
}

function buildBatchMessage() {
    return JSON.parse(JSON.stringify({
        "messageType": "Batch",
        "messageTypeVersion": 1,
        "senderId": "NOVARTIS_PTT_010",
        "receiverId": "ePI_DSU_NOVARTIS",
        "messageId": "00012856374589",
        "messageDateTime": "2021-04-27T13:52:12CET",
        "batch": {
            "productCode": gtin,
            "batch": batchId,
            "expiryDate": "221200",
            "packagingSiteName": "Novartis Stein/Schweiz",
            "epiLeafletVersion": 1,
            "flagEnableExpiredEXPCheck": true,
            "flagEnableBatchRecallMessage": false,
            "recallMessage": "",
            "flagEnableACFBatchCheck": false,
            "acfBatchCheckURL": ""
        }
    }));
}

function getEPIMappingEngine(callback) {
    const enclaveAPI = openDSU.loadAPI("enclave");
    const scAPI = openDSU.loadAPI("sc");

    let enclave = enclaveAPI.initialiseWalletDBEnclave();
    scAPI.setSharedEnclave(enclave, (err) => {
        if (err) {
            throw err;
        }

        scAPI.getSharedEnclave((err, enclave) => {
            if (err) {
                return callback(err);
            }

            //this loads all the necessary mappings
            require("../lib/mappings/index");
            const mappingEngine = openDSU.loadApi("m2dsu").getMappingEngine(enclave, {
                holderInfo: {
                    domain: DOMAIN,
                    subdomain: DOMAIN
                }
            });
            callback(undefined, mappingEngine);
        });
    });
}

function getBrickFilePath(folder, hashLink) {
    let brickFolderName = hashLink.slice(0, 5);
    let targetPath = path.join(path.join(folder, "external-volume/domains/default/brick-storage"), brickFolderName, hashLink);
    return targetPath;
}

function buildTestFunction(gtinSSI, initialMessage, updateMessage) {

    function deleteMutableDSUBrickMap(gtinSSI, folder, callback) {
        const openDSU = require("opendsu");
        const resolver = openDSU.loadApi("resolver");

        resolver.loadDSU(gtinSSI, (err, dsu) => {
            if (err) {
                return callback(err);
            }

            dsu.listMountedDSUs("/", (err, mounts) => {
                if (err) {
                    return callback(err);
                }
                let target = mounts[0].identifier;
                target = openDSU.loadApi("keyssi").parse(target);

                target.getAnchorId((err, anchorId) => {
                    if (err) {
                        return callback(err);
                    }

                    deleteDSUBrickMap(anchorId, 1, folder, callback);
                });
            });
        });
    }

    function deleteDSUBrickMap(keySSI, startIndex, folder, callback) {
        const openDSU = require("opendsu");
        const anchoringX = openDSU.loadApi("anchoring").getAnchoringX();

        anchoringX.getAllVersions(keySSI, (err, versions) => {
            if (err) {
                return callback(err);
            }

            let deleteCounter = 0;
            for (let i = startIndex; i < versions.length; i++) {
                let brickFilePath = getBrickFilePath(folder, versions[i].getHash());
                fs.unlinkSync(brickFilePath);
                deleteCounter++;
            }
            callback(undefined, deleteCounter);
        });
    }

    function deleteConstDSUBrickMap(gtinSSI, folder, callback) {
        deleteDSUBrickMap(gtinSSI, 0, folder, callback);
    }

    return (testFinishCallback) => {
        let testProcedure = async function (err, port) {
            if (err) {
                throw err;
            }

            getEPIMappingEngine((err, mappingEngine) => {
                if (err) {
                    throw err;
                }

                //first step let's create a product based on a good message
                mappingEngine.digestMessages(initialMessage).then((undigested) => {
                    assert.true(undigested.length === 0, "Mapping engine not able to properly digest our message");

                    //all good until now... let's alter the "history"... we delete some bricks from brick storage
                    deleteMutableDSUBrickMap(gtinSSI, folder, (err, deletedBricksCount) => {
                        if (err) {
                            throw err;
                        }

                        assert.true(deletedBricksCount === 1, "Not able to delete brickMap of immutable dsu");

                        deleteConstDSUBrickMap(gtinSSI, folder, (err, deletedBricksCount) => {
                            if (err) {
                                throw err;
                            }

                            assert.true(deletedBricksCount === 1, "Not able to delete brickMap of product const dsu");

                            //we need to invalidate DSUCache because if Const dsu fails the resolver tries to create a const dsu and adds it to the DSUCache
                            resolver.invalidateDSUCache(gtinSSI, () => {
                                mappingEngine.digestMessages(updateMessage).then((undigested) => {
                                    assert.true(undigested.length === 1, "Mapping engine should fail to digest this message due to history alteration");

                                    //we activate the force flag on the message and try again
                                    updateMessage.force = true;

                                    //we need to invalidate DSUCache because if Const dsu fails the resolver tries to create a const dsu and adds it to the DSUCache
                                    resolver.invalidateDSUCache(gtinSSI, () => {
                                        mappingEngine.digestMessages(updateMessage).then((undigested) => {
                                            assert.true(undigested.length === 0, "Mapping engine not able to properly digest our message with the force flag!");
                                            openDSU.loadApi("resolver").invalidateDSUCache(gtinSSI, () => {

                                                resolver.loadDSU(gtinSSI, (err, productConstDSU) => {
                                                    if (err) {
                                                        throw err;
                                                    }
                                                    productConstDSU.readFile("/manifest", (err, manifest) => {
                                                        if (err) {
                                                            throw err;
                                                        }

                                                        assert.true(typeof manifest !== "undefined");
                                                        testFinishCallback();
                                                    });
                                                });
                                            });
                                        }).catch(err => {
                                            throw err;
                                        });
                                    });
                                }).catch(err => {
                                    throw err;
                                });
                            });
                        });
                    });
                }).catch(err => {
                    throw err;
                });
            });
        };
        if (process.port) {
            return testProcedure(undefined, process.port);
        }
        dc.createTestFolder('testFolder', (err, folderName) => {
            if (err) {
                assert.true(false, 'Error creating test folder');
                throw err;
            }

            tir.launchApiHubTestNode(10, folderName, (err, port) => {
                global.folder = folderName;
                if (port) {
                    process.port = port;
                }
                testProcedure(err, port);
            });
        });
    }
}


let initialProductMessage = buildProductMessage();
let updateProductMessage = buildProductMessage();
updateProductMessage.product.strength = "80mg";

let productTest = buildTestFunction(productGtinSSI, initialProductMessage, updateProductMessage);

assert.callback("Recovery Mode for Product based messages", productTest, 1000000);



