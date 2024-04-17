const constants = require("../../constants/constants.js");
const GTIN_SSI = require("../../GTIN_SSI");
const productUtils = require("../product/productUtils");
const errUtils = require("../errors/errorUtils");
const logUtils = require("../../utils/LogUtils");
errUtils.addMappingError("BATCH_DSU_LOAD_FAIL");
errUtils.addMappingError("BATCH_MISSING_PRODUCT");
errUtils.addMappingError("EXISTING_BATCH_ID");
const errMap = require("opendsu").loadApi("m2dsu").getErrorsMap();

async function getBatchDSURecovery(message, productCode, batchId) {

    let seedSSI = await this.createPathSSI(this.options.holderInfo.subdomain, `0/${productCode}/${batchId}`);
    let sreadSSI = await $$.promisify(seedSSI.derive)();

    async function recoveryBatchConstDSU(dsu, callback) {
        let error;
        try {
            await $$.promisify(dsu.mount)(constants.BATCH_DSU_MOUNT_POINT, sreadSSI.getIdentifier());
        } catch (err) {
            const mountError = createOpenDSUErrorWrapper("Failed to mount batch DSU", err);
            error = mountError
        }

        callback(error, dsu);
    }

    return new Promise((resolve, reject) => {
        const gtinSSI = GTIN_SSI.createGTIN_SSI(this.options.holderInfo.domain, this.options.holderInfo.subdomain, productCode, batchId);
        this.recoverDSU(gtinSSI, recoveryBatchConstDSU, async (err, batchConstDSU) => {
            if (err) {
                return reject(err);
            }

            let batchDSU = await $$.promisify(this.recoverDSU)(sreadSSI, (dsu, callback) => {
                dsu.writeFile("/recovered", new Date().toISOString(), {embed: true}, async (err) => {
                    if (err) {
                        const writeError = createOpenDSUErrorWrapper("Failed to write recovered file", err);
                        try {
                            await dsu.cancelBatchAsync();
                        } catch (e) {
                            return callback(createOpenDSUErrorWrapper("Failed to cancel batch on const DSU", e, writeError));
                        }
                        return callback(err);
                    }

                    this.mappingLogService = logUtils.createInstance(this.storageService, this.options.logService);

                    let nextVersion = 0;
                    try {
                        nextVersion = await require("opendsu").loadApi("anchoring").getNextVersionNumberAsync(dsu.getCreationSSI());
                        //i believe that we don't need to decrement any more...
                        //nextVersion--;
                    } catch (err) {
                        throw errMap.newCustomError(errMap.errorTypes.BATCH_DSU_LOAD_FAIL, "batchId");
                    }

                    let logData = {
                        reason: `The batch ${batchId} for GTIN ${productCode} got recovered as version ${nextVersion}.`,
                        pk: require("./../../utils/CommonUtils").getBatchMetadataPK(productCode, batchId),
                        messageId: message.messageId,
                        senderId: message.senderId,
                        messageDateTime: message.messageDateTime,
                        messageType: constants.MESSAGE_TYPES.RECOVER,
                        itemCode: batchId,
                        itemType: "recoveredBatch",
                        batch: {
                            batch: batchId,
                            gtin: productCode
                        }
                    };

                    await this.mappingLogService.logSuccessAction(logData, {}, true, {}, dsu);
                    return callback(undefined, dsu);
                });
            });

            resolve({
                batchConstDSU: batchConstDSU,
                batchDSU: batchDSU,
                alreadyExists: true,
                gtinSSI: gtinSSI
            });
        });
    });
}

async function getBatchDSU(message, productCode, batchId, create = false) {

    if (message.force) {
        return await getBatchDSURecovery.call(this, message, productCode, batchId, create);
    }

    let err;
    let productDSUObj;

    try {
        productDSUObj = await productUtils.getProductDSU.call(this, message, productCode);
    } catch (e) {
        throw errMap.newCustomError(errMap.errorTypes.PRODUCT_DSU_LOAD_FAIL, "productCode");
    }

    if (!productDSUObj) {
        throw errMap.newCustomError(errMap.errorTypes.PRODUCT_DSU_LOAD_FAIL, "productCode");
    }

    const gtinSSI = GTIN_SSI.createGTIN_SSI(this.options.holderInfo.domain, this.options.holderInfo.subdomain, productCode, batchId);
    const {dsu: batchConstDSU, alreadyExists: batchExists} = await this.loadConstSSIDSU(gtinSSI);
    let batchDSU;

    if (!batchExists) {
        batchDSU = await this.createPathSSIDSU(this.options.holderInfo.subdomain, `0/${productCode}/${batchId}`);
        let sreadSSI = await batchDSU.getKeySSIAsString("sread");
        await batchConstDSU.mount(constants.BATCH_DSU_MOUNT_POINT, sreadSSI);
    } else {
        let reason = "batchId";
        try {
            let getSSIForMount = $$.promisify(batchConstDSU.getSSIForMount, batchConstDSU);
            //we read the ssi from the mounting point instead of the sharedDB. is more reliable
            let ssi = await getSSIForMount(constants.BATCH_DSU_MOUNT_POINT);
            //we should check if we still in control of the mutable dsu
            let pathSSI = await this.createPathSSI(this.options.holderInfo.subdomain, `0/${productCode}/${batchId}`);
            let anchorIdFromPath = await pathSSI.getAnchorIdAsync();
            if (typeof ssi === "string") {
                ssi = require("opendsu").loadApi("keyssi").parse(ssi);
            }
            let anchorIdMount = await ssi.getAnchorIdAsync();
            if (anchorIdFromPath !== anchorIdMount) {
                reason = errMap.newCustomError(errMap.errorTypes.PRODUCT_DSU_LOAD_FAIL, new Error("You are not allowed to overwrite a product from a different company."));
                throw reason;
            }
            batchDSU = await this.loadDSU(ssi);
        } catch (err) {
            throw errMap.newCustomError(errMap.errorTypes.BATCH_DSU_LOAD_FAIL, reason);
        }
    }

    return {
        batchConstDSU: batchConstDSU,
        batchDSU: batchDSU,
        alreadyExists: batchExists,
        gtinSSI: gtinSSI
    };
}

async function getBatchMetadata(message, batchId, shouldExist = true) {
    let metadata = {};
    try {
        metadata = await $$.promisify(this.storageService.getRecord, this.storageService)(constants.BATCHES_STORAGE_TABLE, batchId);
        /*    if (!shouldExist && metadata) {
              throw errMap.newCustomError(errMap.errorTypes.EXISTING_BATCH_ID, "batch");
            }*/

    } catch (e) {
        if (shouldExist) {
            if (message.force) {
                //trying to set some defaults in recovery mode

                const utils = require("./../../utils/CommonUtils");
                const data = utils.getDataFromBatchMetadataPK(batchId);
                metadata.batchNumber = data.batch;
                metadata.gtin = data.productCode;
                metadata.productName = "recovered";
                metadata.productDescription = "no description";
                metadata.expiry = "010101";
                metadata = await $$.promisify(this.storageService.insertRecord, this.storageService)(constants.BATCHES_STORAGE_TABLE, batchId, metadata);
            } else {
                throw errMap.newCustomError(errMap.errorTypes.DB_OPERATION_FAIL, "productCode");
            }
        }
    }
    return metadata;
}

module.exports = {
    getBatchDSU,
    getBatchMetadata
}
