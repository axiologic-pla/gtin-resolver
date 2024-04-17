const constants = require("../../constants/constants.js");
const GTIN_SSI = require("../../GTIN_SSI");
const openDSU = require("opendsu");
const errMap = openDSU.loadAPI("m2dsu").getErrorsMap();
const errorUtils = require("../errors/errorUtils");
const validationUtils = require("../../utils/ValidationUtils");
const logUtils = require("../../utils/LogUtils");
errorUtils.addMappingError("PRODUCT_DSU_LOAD_FAIL");
errorUtils.addMappingError("GTIN_VALIDATION_FAIL");

async function getProductDSURecovery(message, productCode) {

    let seedSSI = await this.createPathSSI(this.options.holderInfo.subdomain, `0/${productCode}`);
    let sreadSSI = await $$.promisify(seedSSI.derive)();

    async function recoveryProductConstDSU(dsu, callback) {
        let error;

        try {
            await $$.promisify(dsu.mount)(constants.PRODUCT_DSU_MOUNT_POINT, sreadSSI.getIdentifier());
        } catch (err) {
            const mountError = createOpenDSUErrorWrapper("Failed to mount product DSU", err);
            error = mountError;
        }

        callback(error, dsu);
    }

    return new Promise((resolve, reject) => {
        const gtinSSI = GTIN_SSI.createGTIN_SSI(this.options.holderInfo.domain, this.options.holderInfo.subdomain, productCode);
        this.recoverDSU(gtinSSI, recoveryProductConstDSU, async (err, recoveredDSU) => {
            if (err) {
                return reject(err);
            }

            let productDSU = await $$.promisify(this.recoverDSU)(sreadSSI, (dsu, callback) => {
                dsu.writeFile("/recovered", new Date().toISOString(), async (err) => {
                    if (err) {
                        return callback(err);
                    }

                    this.mappingLogService = logUtils.createInstance(this.storageService, this.options.logService);

                    let nextVersion = 0;
                    try {
                        nextVersion = await require("opendsu").loadApi("anchoring").getNextVersionNumberAsync(dsu.getCreationSSI());
                        //i believe that we don't need to decrement any more...
                        //nextVersion--;
                    } catch (err) {
                        throw errMap.newCustomError(errMap.errorTypes.PRODUCT_DSU_LOAD_FAIL, "productCode");
                    }

                    let logData = {
                        reason: `The product with GTIN ${productCode} got recovered as version ${nextVersion}.`,
                        pk: productCode,
                        messageId: message.messageId,
                        senderId: message.senderId,
                        messageDateTime: message.messageDateTime,
                        messageType: constants.MESSAGE_TYPES.RECOVER,
                        itemCode: productCode,
                        itemType: constants.MESSAGE_TYPES.RECOVER,
                        product: {
                            gtin: productCode
                        }
                    };

                    await this.mappingLogService.logSuccessAction(logData, {}, true, {}, dsu);
                    return callback(undefined, dsu);
                });
            });
            resolve({constDSU: recoveredDSU, productDSU: productDSU, alreadyExists: true});
        });
    });
}

async function getProductDSU(message, productCode, create = false) {

    if (message.force) {
        return await getProductDSURecovery.call(this, message, productCode, create);
    }

    let productDSU = {};
    const gtinSSI = GTIN_SSI.createGTIN_SSI(this.options.holderInfo.domain, this.options.holderInfo.subdomain, productCode);
    const {dsu, alreadyExists} = await this.loadConstSSIDSU(gtinSSI);

    if (create && !alreadyExists) {
        productDSU = await this.createPathSSIDSU(this.options.holderInfo.subdomain, `0/${productCode}`);
        let sreadSSI = await productDSU.getKeySSIAsString("sread");
        await dsu.mount(constants.PRODUCT_DSU_MOUNT_POINT, sreadSSI);
        return {constDSU: dsu, productDSU: productDSU, alreadyExists: alreadyExists};
    }

    let reason = "productCode";
    try {
        let getSSIForMount = $$.promisify(dsu.getSSIForMount);
        //we read the ssi from the mounting point instead of the sharedDB. is more reliable
        let ssi = await getSSIForMount(constants.PRODUCT_DSU_MOUNT_POINT);
        //we should check if we still in control of the mutable dsu
        let pathSSI = await this.createPathSSI(this.options.holderInfo.subdomain, `0/${productCode}`);
        let anchorIdFromPath = await pathSSI.getAnchorIdAsync();
        if (typeof ssi === "string") {
            ssi = require("opendsu").loadApi("keyssi").parse(ssi);
        }
        let anchorIdMount = await ssi.getAnchorIdAsync();
        if (anchorIdFromPath !== anchorIdMount) {
            reason = new Error("You are not allowed to overwrite a product from a different company.");
            throw reason;
        }
        productDSU = await this.loadDSU(ssi);
    } catch (err) {
        throw errMap.newCustomError(errMap.errorTypes.PRODUCT_DSU_LOAD_FAIL, reason);
    }
    return {constDSU: dsu, productDSU: productDSU, alreadyExists: alreadyExists};
}

async function validateGTIN(message) {
    let gtinValidationResult = validationUtils.validateGTIN(message.product.productCode);
    if (!gtinValidationResult.isValid) {
        message.invalidFields = [{
            field: "productCode",
            message: gtinValidationResult.message
        }]
        errMap.setErrorMessage("GTIN_VALIDATION_FAIL", gtinValidationResult.message);
        throw errMap.newCustomError(errMap.errorTypes.GTIN_VALIDATION_FAIL, "productCode");
    }
}

async function getProductMetadata(message, productCode, shouldExist = true) {
    let productMetadata = {};
    try {
        productMetadata = await $$.promisify(this.storageService.getRecord, this.storageService)(constants.PRODUCTS_TABLE, productCode);
    } catch (e) {
        if (shouldExist) {
            if (message.force) {
                //trying to set some defaults in recovery mode
                productMetadata.gtin = productCode;
                productMetadata.name = "Recovered product";
                productMetadata.description = "no description";
                productMetadata = await $$.promisify(this.storageService.insertRecord, this.storageService)(constants.PRODUCTS_TABLE, productCode, productMetadata);
            } else {
                throw errMap.newCustomError(errMap.errorTypes.DB_OPERATION_FAIL, "productCode");
            }
        }
    }
    return productMetadata;
}

module.exports = {
    getProductDSU,
    getProductMetadata,
    validateGTIN
}
