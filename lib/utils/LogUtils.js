const constants = require("../constants/constants");
const utils = require("../utils/CommonUtils.js");
let instance;
const dbMessageFields = ["pk", "meta", "did", "__timestamp", "$loki", "context", "keySSI", "epiProtocol", "version"];
const crypto = require("opendsu").loadAPI("crypto");

function MappingLogService(storageService, logService) {
    this.storageService = storageService;
    this.logService = logService;

    this.getMappingLogs = (callback) => {
        this.storageService.filter(constants.IMPORT_LOGS, "__timestamp > 0", callback);
    }

    this.refreshAsync = async () => {
        if (typeof storageService.refresh === "function") {
            return await $$.promisify(storageService.refresh)();
        }
    };

    this.createLogInfoDSU = async (message, diffs) => {
        const openDSU = require("opendsu");
        const keyssi = openDSU.loadApi("keyssi");
        const scAPI = openDSU.loadAPI("sc");
        const vaultDomain = await $$.promisify(scAPI.getVaultDomain)();
        const seedSSI = keyssi.createTemplateSeedSSI(vaultDomain, undefined, undefined, "v0");
        let auditObj = {"logInfo": message};
        if (diffs) {
            auditObj["diffs"] = diffs
        }
        let auditData = JSON.stringify(auditObj);
        console.log(`Creating Log DSU. Storage is in progress ${this.storageService.batchInProgress()}`);
        const mainEnclave = await $$.promisify(scAPI.getMainEnclave)();
        console.log(`Batch in progress: ${mainEnclave.batchInProgress()}`);
        const enclaveAPI = openDSU.loadAPI("enclave");
        const memoryEnclave = enclaveAPI.initialiseMemoryEnclave();
        let rowDossier = await $$.promisify(memoryEnclave.createDSU)(undefined, seedSSI);
        $$.debug.logDSUEvent(rawDossier, `Is audit dsu`);
        let batchId = await rowDossier.safeBeginBatchAsync();
        await $$.promisify(rowDossier.writeFile)("/audit.json", auditData);
        await rowDossier.commitBatchAsync(batchId);
        let keySSI = await $$.promisify(rowDossier.getKeySSIAsString)();
        return keySSI
    }

    this.logSuccessAction = async (message, data, alreadyExists, diffs, DSU) => {
        if ($$.uiProgressService) {
            $$.uiProgressService.showProgress("Audit operation in progress. Please wait...");
        }
        let logData = getLogData(message, data, alreadyExists);
        logData.status = constants.SUCCESS_MAPPING_STATUS;
        let auditKeySSI = await this.createLogInfoDSU(message, diffs);
        logData.auditLogData.auditKeySSI = auditKeySSI;
        let keySSIObj = await $$.promisify(DSU.getKeySSIAsObject)();
        logData.auditLogData.anchorId = await $$.promisify(keySSIObj.getAnchorId)();
        const latestHashLink = await $$.promisify(DSU.getLatestAnchoredHashLink)();
        logData.auditLogData.hashLink = latestHashLink.getIdentifier();
        await logAction(logData);
        if ($$.uiProgressService) {
            $$.uiProgressService.closeProgress();
        }
        return logData;
    }

    this.logFailAction = async (message, data, status) => {
        if ($$.uiProgressService) {
            $$.uiProgressService.showProgress("Audit operation in progress. Please wait...");
        }
        let logData = getLogData(message, data || status, true, status);
        let logStatus = status ? status : constants.FAILED_MAPPING_STATUS;
        logData.status = logStatus;
        let auditKeySSI = await this.createLogInfoDSU(message);
        logData.auditLogData.auditKeySSI = auditKeySSI;

        logData.invalidFields = message.invalidFields;
        logData.auditLogData.logType = constants.LOG_TYPES.FAILED_ACTION;
        logData.auditLogData.status = logStatus;
        logData.auditLogData.reason = "Failed - See details";

        await logAction(logData);
        if ($$.uiProgressService) {
            $$.uiProgressService.closeProgress();
        }
        return logData;
    }

    let logAction = async (logData) => {
        let batchId = await this.storageService.startOrAttachBatchAsync();
        //we are trying to overwrite the pk to prevent audit log loss
        logData.pk = logData.itemCode + "|" + logData.timestamp + "|" + crypto.encodeBase58(crypto.generateRandom(8));

        if (typeof this.logService !== "undefined") {
            try {
                await $$.promisify(this.logService.log, this.logService)(logData.auditLogData);
            } catch (err) {
                console.error("This case needs dev attention", err);
                await this.storageService.cancelBatchAsync(batchId);
                return;
            }
        }
        try {
            await $$.promisify(this.storageService.addIndex, this.storageService)(constants.IMPORT_LOGS, "__timestamp");
            await $$.promisify(this.storageService.insertRecord, this.storageService)(constants.IMPORT_LOGS, logData.pk, logData);
            await this.storageService.commitBatchAsync(batchId);
        } catch (e) {
            console.error("This case needs developer attention", e);
            await this.storageService.cancelBatchAsync(batchId);
        }
    }

    let cleanMessage = (message) => {
        let cleanMessage = JSON.parse(JSON.stringify(message));
        dbMessageFields.forEach(field => {
            if (field in cleanMessage) {
                delete cleanMessage[field]
            }
        })
        return cleanMessage;
    }

    this.getDiffsForAudit = (newData, prevData) => {
        if (prevData && (Array.isArray(prevData) || Object.keys(prevData).length > 0)) {
            prevData = cleanMessage(prevData);
            newData = cleanMessage(newData);

            let diffs = Object.keys(newData).reduce((diffs, key) => {
                if (JSON.stringify(prevData[key]) === JSON.stringify(newData[key])) return diffs
                return {
                    ...diffs, [key]: {oldValue: prevData[key], newValue: newData[key]}
                }
            }, {})
            return diffs;
        }
    }

    let getLogData = (message, data, alreadyExists) => {
        message = cleanMessage(message);
        let resultObj = {
            itemCode: "unknown",
            itemType: "unknown",
            timestamp: new Date().getTime(),
            messageId: message.messageId || crypto.encodeBase58(crypto.generateRandom(32)),
            auditLogData: {
                username: message.senderId,
                auditId: message.messageId + "|" + message.senderId + "|" + message.messageDateTime
            },
            metadata: {}
        };
        let auditLogType = "";

        try {
            switch (message.messageType) {
                case constants.MESSAGE_TYPES.BATCH:
                    resultObj.reason = alreadyExists ? "Edited Batch" : "Created Batch";
                    resultObj.mappingLogMessage = alreadyExists ? "updated" : "created";
                    resultObj.pk = utils.getBatchMetadataPK(message.batch.productCode, message.batch.batch);
                    resultObj.itemCode = message.batch.batch || resultObj.itemCode;
                    resultObj.itemType = message.messageType;
                    resultObj.table = constants.BATCHES_STORAGE_TABLE;
                    auditLogType = constants.LOG_TYPES.BATCH;
                    resultObj.metadata.gtin = message.batch.productCode;
                    break;
                case constants.MESSAGE_TYPES.PRODUCT:
                    resultObj.reason = alreadyExists ? "Edited Product" : "Created Product";
                    resultObj.mappingLogMessage = alreadyExists ? "updated" : "created";
                    resultObj.pk = message.product.productCode;
                    resultObj.itemCode = message.product.productCode || resultObj.itemCode;
                    resultObj.itemType = message.messageType;
                    resultObj.table = constants.PRODUCTS_TABLE;
                    auditLogType = constants.LOG_TYPES.PRODUCT
                    resultObj.metadata.gtin = message.product.productCode;
                    break;
                case constants.MESSAGE_TYPES.PRODUCT_PHOTO:
                    resultObj.reason = alreadyExists ? "Updated Product Photo" : "Edited Product Photo";
                    resultObj.mappingLogMessage = alreadyExists ? "updated photo" : "created photo";
                    resultObj.pk = message.productCode;
                    resultObj.itemCode = message.productCode || resultObj.itemCode;
                    resultObj.itemType = message.messageType;
                    resultObj.table = constants.PRODUCTS_TABLE;
                    auditLogType = constants.LOG_TYPES.PRODUCT_PHOTO;
                    resultObj.metadata.attachedTo = "PRODUCT";
                    resultObj.metadata.gtin = message.productCode;
                    break;
                case constants.MESSAGE_TYPES.LEAFLET:
                case constants.MESSAGE_TYPES.SMPC:
                    let suffix = message.action === "add" ? "ed" : "d";
                    let leafletStatus = message.action.charAt(0).toUpperCase() + message.action.slice(1) + suffix;
                    resultObj.reason = message.messageType === constants.MESSAGE_TYPES.LEAFLET ? `${leafletStatus} Leaflet` : `${leafletStatus} SMPC`;
                    resultObj.mappingLogMessage = message.messageType === constants.MESSAGE_TYPES.LEAFLET ? `${leafletStatus} leaflet` : `${leafletStatus} SMPC`;
                    resultObj.itemType = message.messageType;
                    if (message.batchCode) {
                        resultObj.metadata.attachedTo = "BATCH";
                        resultObj.metadata.batch = message.batchCode;
                        resultObj.itemCode = message.batchCode;
                    } else {
                        resultObj.metadata.attachedTo = "PRODUCT";
                        resultObj.itemCode = message.productCode;
                    }
                    resultObj.metadata.gtin = message.productCode;
                    auditLogType = constants.LOG_TYPES.LEAFLET_LOG;
                    break;
                case constants.MESSAGE_TYPES.VIDEO_SOURCE:
                    resultObj.reason = "Updated Video Source";
                    resultObj.mappingLogMessage = "updated";
                    resultObj.itemType = message.messageType;
                    auditLogType = constants.LOG_TYPES.VIDEO_SOURCE;
                    if (message.videos.batch) {
                        resultObj.pk = message.videos.batch;
                        resultObj.metadata.attachedTo = "BATCH";
                        resultObj.metadata.batch = message.videos.batch;
                        resultObj.itemCode = message.videos.batch;
                        resultObj.table = constants.BATCHES_STORAGE_TABLE;
                    } else {
                        resultObj.pk = message.videos.productCode;
                        resultObj.metadata.attachedTo = "PRODUCT";
                        resultObj.itemCode = message.videos.productCode;
                        resultObj.table = constants.PRODUCTS_TABLE;
                    }
                    resultObj.metadata.gtin = message.videos.productCode;
                    break;
                case constants.MESSAGE_TYPES.RECOVER:
                    resultObj.pk = message.pk;
                    resultObj.reason = message.reason || "Recovery action";
                    resultObj.mappingLogMessage = "success";
                    resultObj.itemCode = message.itemCode || resultObj.itemCode;
                    resultObj.metadata.gtin = "unknown";
                    if (message.batch) {
                        resultObj.metadata.gtin = message.batch.gtin;
                        resultObj.metadata.batch = message.batch.batch;
                    }
                    if (message.product) {
                        resultObj.metadata.gtin = message.product.gtin;
                    }
                    resultObj.itemType = message.messageType || "unknown";
                    auditLogType = constants.LOG_TYPES.RECOVER;
                    break;
                default:
                    throw new Error("Unknown message type");
            }
        } catch (err) {
            resultObj.reason = "Edit action";
            resultObj.mappingLogMessage = "failed";
            resultObj.itemCode = resultObj.itemCode || "unknown";
            resultObj.itemType = message.messageType || "unknown";
            resultObj.metadata.failReason = err.message;
            auditLogType = constants.LOG_TYPES.FAILED_ACTION;
        }

        resultObj.auditLogData.reason = resultObj.reason;
        resultObj.auditLogData.itemCode = resultObj.itemCode;
        resultObj.auditLogData.logType = auditLogType;
        resultObj.auditLogData.metadata = resultObj.metadata;
        resultObj.auditLogData.gtin = resultObj.metadata.gtin;
        return resultObj;
    }
}

module.exports = {
    createInstance: function (storageService, logService) {
        if (!instance) {
            instance = new MappingLogService(storageService, logService);
        }
        return instance;
    }
}