const errMap = require("opendsu").loadApi("m2dsu").getErrorsMap();
const utils = require("../../utils/CommonUtils.js");

function getLeafletDirPath(type, language) {
    return `/${type}/${language}`;
}

function getLeafletPath(type, language) {
    return `${getLeafletDirPath(type, language)}/${type}.xml`;
}

function getLeafletTypes() {
    return {
        "SMPC": "smpc",
        "LEAFLET": "leaflet"
    }
}

function getService(dsu, gtin, leafletType) {
    const gtinSSI = dsu.getCreationSSI();
    const XMLDisplayService = require("../../services/XMLDisplayService/XMLDisplayService.js");
    const keyssi = require("opendsu").loadApi("keyssi");
    const simulatedModel = {networkName: keyssi.parse(gtinSSI).getDLDomain(), product: {gtin}};
    const service = new XMLDisplayService(undefined, gtinSSI, simulatedModel, leafletType, undefined);
    return service;
}

function getBatchAvailableLanguages(dsu, gtin, leafletType, callback) {
    const service = getService(dsu, gtin, leafletType);
    service.readLanguagesFromDSU(dsu, `/${leafletType}`, callback);
}

function getProductAvailableLanguages(dsu, gtin, leafletType, callback) {
    const service = getService(dsu, gtin, leafletType);
    service.readLanguagesFromDSU(dsu, `/${leafletType}`, callback);
}

async function updateVersionOnTarget(context, message, hostDSU, hostMetadata) {
    const utils = require("../utils");
    const constants = require("../../constants/constants");

    let indications = utils.getProductJSONIndication(message);
    Object.assign(indications, utils.getBatchJSONIndication(message));
    await context.loadJSONS.call(context, hostDSU, indications);

    let productOrBatch = context.product || context.batch;
    productOrBatch.version = await require("opendsu").loadApi("anchoring").getNextVersionNumberAsync(hostDSU.getCreationSSI());
    hostMetadata.version = productOrBatch.version;

    if (context.batch) {
        if (!hostMetadata.pk) {
            hostMetadata.pk = require("../../utils/CommonUtils").getBatchMetadataPK(context.batch.productCode, context.batch.batch);
        }
        await $$.promisify(context.storageService.updateRecord, context.storageService)(constants.BATCHES_STORAGE_TABLE, hostMetadata.pk, hostMetadata);
        await context.saveJSONS.call(context, hostDSU, utils.getBatchJSONIndication(message));
    } else {
        if (!hostMetadata.pk) {
            hostMetadata.pk = context.product.productCode;
        }
        await $$.promisify(context.storageService.updateRecord, context.storageService)(constants.PRODUCTS_TABLE, hostMetadata.pk, hostMetadata);
        await context.saveJSONS.call(context, hostDSU, utils.getProductJSONIndication(message));
    }

}

module.exports = {
    updateVersionOnTarget,
    getLeafletPath,
    getLeafletDirPath,
    getBatchAvailableLanguages,
    getProductAvailableLanguages,
    getLeafletTypes,
    getService,
    getHostDSUData: async function (message) {
        let hostDSU;
        let errorType;
        let errorDetails;
        let hostMetadata;

        try {
            if (message.batchCode) {
                errorType = errMap.errorTypes.BATCH_DSU_LOAD_FAIL;
                errorDetails = `for batch ${message.batchCode}`;
                let res = await require("../batch/batchUtils").getBatchDSU.call(this, message, message.productCode, message.batchCode);
                hostDSU = res.batchDSU;
                hostMetadata = await require("../batch/batchUtils").getBatchMetadata.call(this, message, utils.getBatchMetadataPK(message.productCode, message.batchCode), true);

            } else {
                errorType = errMap.errorTypes.PRODUCT_DSU_LOAD_FAIL;
                errorDetails = `for productCode ${message.productCode}`;
                let res = await require("../product/productUtils").getProductDSU.call(this, message, message.productCode);
                hostDSU = res.productDSU;
                hostMetadata = await require("../product/productUtils").getProductMetadata.call(this, message, message.productCode, true);

            }
        } catch (err) {
            throw errMap.newCustomError(errorType, errorDetails);
        }

        return {hostDSU, hostMetadata}
    }

}
