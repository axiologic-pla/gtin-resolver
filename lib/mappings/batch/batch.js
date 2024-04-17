const utils = require("../../utils/CommonUtils");
const validationUtils = require("../../utils/ValidationUtils");
const constants = require("../../constants/constants.js");
const batchUtils = require("./batchUtils");
const ModelMessageService = require('../../services/ModelMessageService');
const logUtils = require("../../utils/LogUtils");
const schema = require("./batchSchema");
const dbUtils = require("../../utils/DBUtils");
const productUtils = require("../product/productUtils");

function verifyIfBatchMessage(message) {
    return message.messageType === "Batch";
}

async function processBatchMessage(message) {

    this.mappingLogService = logUtils.createInstance(this.storageService, this.options.logService);

    // await validationUtils.validateMessageOnSchema.call(this, message, schema);
    await validationUtils.validateMVP1Values.call(this, message, "batch");
    const batchId = message.batch.batch;
    const productCode = message.batch.productCode;

    const {
        batchDSU,
        batchConstDSU,
        alreadyExists,
        gtinSSI
    } = await batchUtils.getBatchDSU.call(this, message, productCode, batchId, true);

    let anchoringDomain = this.options.holderInfo.domain;
    let brickingDomain = this.options.holderInfo.subdomain;

    let batchMetadata = await batchUtils.getBatchMetadata.call(this, message, utils.getBatchMetadataPK(productCode, batchId), alreadyExists);

    /*
  * extension of the file will contain epi version. Used format is epi_+epiVersion;
  * Ex: for version 1 - batch.epi_v1
  *  */
    const indication = require("../utils").getBatchJSONIndication(message);

    await this.loadJSONS(batchDSU, indication);

    if (typeof this.batch === "undefined") {
        this.batch = JSON.parse(JSON.stringify(batchMetadata));
    } else {
        //the batch is not new... we need to signal fixedUrl that an update will follow
        const utils = require("./../utils");
        await $$.promisify(utils.deactivateGtinOwnerFixedUrl)(batchConstDSU, anchoringDomain, productCode);
        await $$.promisify(utils.deactivateLeafletFixedUrl)(batchConstDSU, brickingDomain, productCode);
    }

    let modelMsgService = new ModelMessageService("batch");
    //this line is similar to Object.assign, we try to get all the props from the message and assign to our batch model
    this.batch = {...this.batch, ...modelMsgService.getModelFromMessage(message.batch)};

    let {productDSU} = await productUtils.getProductDSU.call(this, message, productCode);

    const productIndication = {product: `${constants.PRODUCT_STORAGE_FILE}${message.messageTypeVersion}`};

    await this.loadJSONS(productDSU, productIndication);

    this.batch.productName = this.product.name;
    this.batch.productDescription = this.product.description;

    let diffs = this.mappingLogService.getDiffsForAudit(modelMsgService.getMessageFromModel(this.batch), alreadyExists ? modelMsgService.getMessageFromModel(batchMetadata) : null);

    if (this.batch.creationTime) {
        this.batch.creationTime = utils.convertDateTOGMTFormat(new Date());
    }

    this.batch.messageTime = message.messageDateTime;

    if (!this.batch.bloomFilterSerialisations) {
        this.batch.bloomFilterSerialisations = [];
    }

    manageSerialNumbers(this.batch);

    this.batch.version = await require("opendsu").loadApi("anchoring").getNextVersionNumberAsync(batchDSU.getCreationSSI());

    const batchClone = JSON.parse(JSON.stringify(this.batch));

    //we delete the arrays because they contain sensitive serial numbers, and we don't want them stored in "clear" in DSU.
    delete this.batch.serialNumbers;
    delete this.batch.recalledSerialNumbers;
    delete this.batch.decommissionedSerialNumbers;

    this.batch.epiProtocol = `v${message.messageTypeVersion}`;

    await this.saveJSONS(batchDSU, indication);

    Object.assign(batchMetadata, this.batch);
    if (!batchMetadata.pk) {
        batchMetadata.pk = utils.getBatchMetadataPK(productCode, batchId);
    }

    if (alreadyExists) {
        await $$.promisify(this.storageService.updateRecord, this.storageService)(constants.BATCHES_STORAGE_TABLE, batchMetadata.pk, batchMetadata);
    } else {
        await $$.promisify(this.storageService.insertRecord, this.storageService)(constants.BATCHES_STORAGE_TABLE, batchMetadata.pk, batchMetadata);
    }

    batchDSU.onCommitBatch(async () => {
        await this.mappingLogService.logSuccessAction(message, this.batch, alreadyExists, diffs, batchDSU);
    }, true);

    try {
        const fixedUrl = require("./../utils");
        await $$.promisify(fixedUrl.registerGtinOwnerFixedUrlByDomain)(anchoringDomain, productCode);
        const leafletUtils = require("./../leaflet/leafletUtils");
        let leafletTypes = Object.keys(leafletUtils.getLeafletTypes());
        for (let type of leafletTypes) {
            type = leafletUtils.getLeafletTypes()[type];

            let languages = [];

            function merge(langs) {
                for (let lang of langs) {
                    if (languages && languages.indexOf(lang) === -1) {
                        languages.push(lang);
                    }
                }
            }

            let prodLangs = await $$.promisify(leafletUtils.getProductAvailableLanguages)(productDSU, productCode, type);
            merge(prodLangs);

            let batchLanguages = await $$.promisify(leafletUtils.getBatchAvailableLanguages)(batchDSU, productCode, type);
            merge(batchLanguages);

            for (let lang of languages) {
                let expirationDate = require("./../../utils/CommonUtils").convertFromGS1DateToYYYY_HM(this.batch.expiry);
                let args = [anchoringDomain, brickingDomain, type, productCode, lang, this.batch.batchNumber, expirationDate, this.batch.epiLeafletVersion];
                await fixedUrl.registerLeafletFixedUrlByDomainAsync(...args);
                //let's register a supplementary fixedUrl without expiration date.
                args = [anchoringDomain, brickingDomain, type, productCode, lang, this.batch.batchNumber, undefined, this.batch.epiLeafletVersion];
                await fixedUrl.registerLeafletFixedUrlByDomainAsync(...args);
            }
        }

        fixedUrl.activateGtinOwnerFixedUrl(batchConstDSU, anchoringDomain, productCode);
        fixedUrl.activateLeafletFixedUrl(batchConstDSU, brickingDomain, productCode);
    } catch (err) {
        console.log("Batch Mapping failed due to", err);
        const errMap = require("opendsu").loadApi("m2dsu").getErrorsMap();
        const errorUtils = require("../errors/errorUtils");
        errorUtils.addMappingError("NOT_ABLE_TO_ENSURE_DATA_CONSISTENCY_ON_SERVER");
        throw errMap.newCustomError(errMap.errorTypes.NOT_ABLE_TO_ENSURE_DATA_CONSISTENCY_ON_SERVER, message.messageType);
    }

    //from this line all the modifications will be only in sharedDB and not DSU

    // this.batch.keySSI = await batchDSU.getKeySSIAsString();

    this.batch.consKeySSI = gtinSSI;
    batchClone.keySSI = this.batch.keySSI;

    await dbUtils.createOrUpdateRecord(this.storageService, {
        table: constants.BATCHES_STORAGE_TABLE,
        pk: batchMetadata.pk
    }, batchClone);
}

function removeAllBloomFiltersOfType(bfList, type) {
    return bfList.filter((bfObj) => bfObj.type !== type);
}

function manageSerialNumbers(batch) {

    if (batch.snValidReset) {
        batch.bloomFilterSerialisations = removeAllBloomFiltersOfType(batch.bloomFilterSerialisations, constants.VALID_SERIAL_NUMBER_TYPE)
        batch.defaultSerialNumber = "";
        batch.snValidReset = false;
    }

    if (batch.snRecalledReset) {
        batch.bloomFilterSerialisations = removeAllBloomFiltersOfType(batch.bloomFilterSerialisations, constants.RECALLED_SERIAL_NUMBER_TYPE)
        batch.defaultRecalledSerialNumber = "";
        batch.snRecalledReset = false;
    }

    if (batch.snDecomReset) {
        batch.bloomFilterSerialisations = removeAllBloomFiltersOfType(batch.bloomFilterSerialisations, constants.DECOMMISSIONED_SERIAL_NUMBER_TYPE)
        batch.defaultDecommissionedSerialNumber = "";
        batch.snDecomReset = false;
    }

    let bf;
    if (batch.serialNumbers && batch.serialNumbers.length > 0) {
        bf = utils.getBloomFilterSerialisation(batch.serialNumbers);
        // batch.bloomFilterSerialisations.push(bf.bloomFilterSerialisation());
        batch.bloomFilterSerialisations.push({
            serialisation: bf.bloomFilterSerialisation(),
            type: constants.VALID_SERIAL_NUMBER_TYPE
        });
        batch.defaultSerialNumber = batch.serialNumbers[0];
    }

    if (batch.recalledSerialNumbers && batch.recalledSerialNumbers.length > 0) {
        bf = utils.getBloomFilterSerialisation(batch.recalledSerialNumbers);
        // batch.bloomFilterRecalledSerialisations.push(bf.bloomFilterSerialisation());
        batch.bloomFilterSerialisations.push({
            serialisation: bf.bloomFilterSerialisation(),
            type: constants.RECALLED_SERIAL_NUMBER_TYPE
        });
        batch.defaultRecalledSerialNumber = batch.recalledSerialNumbers[0];
    }
    if (batch.decommissionedSerialNumbers && batch.decommissionedSerialNumbers.length > 0) {
        bf = utils.getBloomFilterSerialisation(batch.decommissionedSerialNumbers);
        // batch.bloomFilterDecommissionedSerialisations.push(bf.bloomFilterSerialisation());
        batch.bloomFilterSerialisations.push({
            serialisation: bf.bloomFilterSerialisation(),
            type: constants.DECOMMISSIONED_SERIAL_NUMBER_TYPE
        });
        batch.defaultDecommissionedSerialNumber = batch.decommissionedSerialNumbers[0];
    }
}

require("opendsu").loadApi("m2dsu").defineMapping(verifyIfBatchMessage, processBatchMessage);
