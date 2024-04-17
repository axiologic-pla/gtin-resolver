function LeafletController(enclave, version) {
    const {getUserId} = require("../utils/getUserId");
    const logger = $$.getLogger("LeafletController", "integrationAPIs");
    const productFactory = require("../factories/ProductFactory.js").getInstance(enclave);
    const batchFactory = require("../factories/BatchFactory.js").getInstance(enclave);
    const auditService = require("../services/AuditService.js").getInstance(enclave);
    const validationService = require("../services/ValidationService.js").getInstance();
    const constants = require("../utils/constants.js");
    const OPERATIONS = constants.OPERATIONS;

    function prepareAuditEntries(userId, gtin, batchNumber, reqMethod) {

        let operationInProgressContext = {
            userId,
            gtin,
            batchNumber,
            operation: reqMethod === "POST" ? OPERATIONS.ADD_LEAFLET_IN_PROGRESS : OPERATIONS.UPDATE_LEAFLET_IN_PROGRESS
        }

        let operationFailContext = {
            userId,
            gtin,
            batchNumber,
            operation: reqMethod === "POST" ? OPERATIONS.ADD_LEAFLET_FAIL : OPERATIONS.UPDATE_LEAFLET_FAIL
        }

        let operationSuccessContext = {
            userId,
            gtin,
            batchNumber,
            operation: reqMethod === "POST" ? OPERATIONS.ADD_LEAFLET : OPERATIONS.UPDATE_LEAFLET
        }
        return {operationInProgressContext, operationFailContext, operationSuccessContext}
    }

    this.addEPI = async (domain, subdomain, gtin, batchNumber, language, epiType, leafletMessage, req, res) => {
        const userId = getUserId(req, leafletMessage);
        let base64XMLFileContent;
        try {
            base64XMLFileContent = await validationService.validateLeafletMessage(leafletMessage);
        } catch (err) {
            logger.error(err);
            let details = err.reason || err.message;
            try {
                details = JSON.parse(details);
            } catch (err) {
                //ignorable error
            }
            res.send(422, JSON.stringify({message: "Payload validation failed", details}));
            return;
        }

        let epiTypes = ["leaflet", "smpc"];
        if (!epiType || epiTypes.indexOf(epiType) === -1) {
            res.send(400);
            return;
        }

        if (gtin !== leafletMessage.payload.productCode) {
            res.send(422, JSON.stringify({
                message: "Payload validation failed",
                details: "Different gtin between url params and payload."
            }));
            return;
        }

        if (batchNumber && batchNumber !== leafletMessage.payload.batchNumber) {
            res.send(422, JSON.stringify({
                message: "Payload validation failed",
                details: "Different batch info between url params and payload."
            }));
            return;
        }

        let {
            operationInProgressContext,
            operationFailContext,
            operationSuccessContext
        } = prepareAuditEntries(userId, gtin, batchNumber, req.method);

        let auditId;
        try {
            auditId = await auditService.auditOperationInProgress(operationInProgressContext);
        } catch (err) {
            logger.error(err);
            res.send(500, "Failed to audit start of an operation");
            return;
        }

        const productCode = gtin;

        let targetObject;
        try {

            if (!batchNumber) {
                targetObject = await productFactory.lookupProduct(domain, subdomain, productCode, version);
            } else {
                targetObject = await batchFactory.lookupBatch(domain, subdomain, productCode, batchNumber, version);
            }

            if (!targetObject) {
                //if we don't have a product/batch to update ...
                await auditService.auditFail(auditId, operationFailContext);
                res.send(404, "Product/Batch not found");
                return;
            }
            let {otherFilesContent} = leafletMessage.payload;
            try {
                await targetObject.addEPI(language, epiType, base64XMLFileContent, otherFilesContent);
                await targetObject.persist(operationSuccessContext);
            } catch (err) {
                logger.error(err);
                await auditService.auditFail(auditId, operationFailContext);
                res.send(500);
                return;
            }

        } catch (err) {
            logger.error(err);
            await auditService.auditFail(auditId, operationFailContext);
            res.send(500);
            return;
        }

        if (operationSuccessContext.version) {
            if (!batchNumber) {
                await auditService.auditProductVersionChange(productCode, operationSuccessContext.version);
            } else {
                await auditService.auditBatchVersionChange(productCode, batchNumber, operationSuccessContext.version);
            }
        }

        operationSuccessContext.diffs.push({epiLanguage: language, epiType});
        await auditService.auditSuccess(auditId, operationSuccessContext);
        res.send(200);
    }

    this.getEPI = async (domain, subdomain, gtin, batchNumber, language, type, dsuVersion, req, res) => {
        let targetObject;
        try {

            if (!batchNumber) {
                targetObject = await productFactory.lookupProduct(domain, subdomain, gtin, version);
            } else {
                targetObject = await batchFactory.lookupBatch(domain, subdomain, gtin, batchNumber, version);
            }

            if (!targetObject) {
                res.send(412, "Product/Batch not found");
                return;
            }

            let epi = await targetObject.getEpi(language, type, dsuVersion);
            return epi;
        } catch (err) {
            logger.error(err);
            res.send(500, "Failed to get EPI");
        }
    }

    this.updateEPI = this.addEPI;

    this.deleteEPI = async (domain, subdomain, productCode, batchNumber, language, epiType, req, res) => {
        const userId = getUserId(req);
        let successStatusCode = 200;

        let epiTypes = ["leaflet", "smpc"];
        if (!epiType || epiTypes.indexOf(epiType) === -1) {
            res.send(400);
            return;
        }

        const operationInProgressContext = {
            userId,
            gtin: productCode,
            batchNumber,
            operation: OPERATIONS.DELETE_LEAFLET_IN_PROGRESS
        }

        const operationFailContext = {
            userId,
            gtin: productCode,
            batchNumber,
            operation: OPERATIONS.DELETE_LEAFLET_FAIL
        }

        const operationSuccessContext = {
            userId,
            gtin: productCode,
            batchNumber,
            operation: OPERATIONS.DELETE_LEAFLET
        }

        let auditId;
        try {
            auditId = await auditService.auditOperationInProgress(operationInProgressContext);
        } catch (err) {
            res.send(500, "Failed to audit start of an operation");
            return;
        }

        let targetObject;
        try {

            if (!batchNumber) {
                targetObject = await productFactory.lookupProduct(domain, subdomain, productCode, version);
            } else {
                targetObject = await batchFactory.lookupBatch(domain, subdomain, productCode, batchNumber, version);
            }

            if (!targetObject) {
                //if we don't have a product/batch to update ...
                await auditService.auditFail(auditId, operationFailContext);
                res.send(404, "Product/Batch not found");
                return;
            }

            try {
                let existing = await targetObject.deleteEPI(language, epiType);
                if (!existing) {
                    successStatusCode = 204;
                }
                await targetObject.persist(operationSuccessContext);
            } catch (err) {
                await auditService.auditFail(auditId, operationFailContext);
                logger.error(err);
                res.send(500);
                return;
            }

        } catch (err) {
            await auditService.auditFail(auditId, operationFailContext);
            logger.error(err);
            return res.send(500, err.message);
        }

        if (operationSuccessContext.version) {
            if (!batchNumber) {
                await auditService.auditProductVersionChange(productCode, operationSuccessContext.version);
            } else {
                await auditService.auditBatchVersionChange(productCode, batchNumber, operationSuccessContext.version);
            }
        }

        operationSuccessContext.diffs.push({epiLanguage: language, epiType});
        await auditService.auditSuccess(auditId, operationSuccessContext);
        res.send(successStatusCode);
    };

    this.tryToDigest = async function (domain, subdomain, message, req, res) {
        try {
            await validationService.validateLeafletMessage(message);
            await this.addEPI(domain, subdomain, message, req, res);
            return true;
        } catch (err) {

        }

        try {
            await validationService.validateLeafletDeleteMessage(message);
            await this.deleteEPI(domain, subdomain, message, req, res);
            return true;
        } catch (err) {

        }

        return false;
    }
}

let instances = {};

function getInstance(enclave, version) {
    if (!instances[version]) {
        instances[version] = new LeafletController(enclave, version);
    }

    return instances[version];
}

module.exports = {
    getInstance
}
