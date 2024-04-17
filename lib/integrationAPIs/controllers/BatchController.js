const recoveryUtils = require("../utils/recoveryUtils.js");

function BatchController(enclave, version) {
    const {getUserId} = require("../utils/getUserId");
    const logger = $$.getLogger("BatchController", "integrationAPIs");
    const batchFactory = require("../factories/BatchFactory.js").getInstance(enclave);
    const productFactory = require("../factories/ProductFactory.js").getInstance(enclave);
    const auditService = require("../services/AuditService.js").getInstance(enclave);
    const validationService = require("../services/ValidationService.js").getInstance();
    const constants = require("../utils/constants.js");
    const OPERATIONS = constants.OPERATIONS;
    this.addBatch = async function (domain, subdomain, gtin, batchNumber, batchMessage, req, res) {
        const userId = getUserId(req, batchMessage);
        let batch;
        try {
            await validationService.validateBatchMessage(batchMessage);
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

        let product;
        try {
            product = await productFactory.lookupProduct(domain, subdomain, gtin, version);
            if (!product) {
                throw Error(`Failed to find a product with gtin ${gtin}`);
            }
        } catch (err) {
            logger.error(err);
            res.send(404, `Product with gtin ${gtin} not found`);
            return;
        }

        const operationInProgressContext = {
            userId,
            gtin,
            batchNumber,
            operation: OPERATIONS.CREATE_BATCH_IN_PROGRESS
        }

        const operationFailContext = {
            userId,
            gtin,
            batchNumber,
            operation: OPERATIONS.CREATE_BATCH_FAIL
        }

        const operationSuccessContext = {
            userId,
            gtin,
            batchNumber,
            operation: OPERATIONS.CREATE_BATCH
        }

        const batchData = batchMessage.payload;
        let auditId;
        try {
            auditId = await auditService.auditOperationInProgress(operationInProgressContext);
        } catch (err) {
            logger.error(err);
            res.send(500, "Failed to audit start of an operation");
            return;
        }

        try {
            batch = await batchFactory.createBatch(domain, subdomain, gtin, batchNumber, version);
            batch.update(batchData);
            try {
                await batch.persist(operationSuccessContext);
            } catch (err) {
                logger.error(err);
                await auditService.auditFail(auditId, operationFailContext);
                res.send(529);
                return;
            }


        } catch (err) {
            logger.error(err);
            await auditService.auditFail(auditId, operationFailContext);
            res.send(500, err.message);
            return;
        }

        await auditService.auditBatch(auditId, JSON.parse(JSON.stringify(batch)), operationSuccessContext);
        res.send(200);
    }

    this.updateBatch = async function (domain, subdomain, gtin, batchNumber, batchMessage, req, res) {
        const userId = getUserId(req, batchMessage);
        let batch;
        try {
            await validationService.validateBatchMessage(batchMessage);
        } catch (err) {
            let details = err.reason || err.message;
            try {
                details = JSON.parse(details);
            } catch (err) {
                //ignorable error
            }
            res.send(422, JSON.stringify({message: "Payload validation failed", details}));
            return;
        }

        const batchData = batchMessage.payload;

        if (gtin !== batchData.productCode) {
            res.send(422, JSON.stringify({
                message: "Payload validation failed",
                details: "Different gtin between url params and payload."
            }));
            return;
        }

        if (batchNumber !== batchData.batchNumber) {
            res.send(422, JSON.stringify({
                message: "Payload validation failed",
                details: "Different batch info between url params and payload."
            }));
            return;
        }

        let product;
        try {
            product = await productFactory.lookupProduct(domain, subdomain, gtin, version);
            if (!product) {
                throw Error(`Failed to find a product with gtin ${gtin}`);
            }
        } catch (err) {
            logger.error(err);
            res.send(404, `Product with gtin ${gtin} not found`);
            return;
        }

        const operationInProgressContext = {
            userId,
            gtin,
            batchNumber,
            operation: OPERATIONS.UPDATE_BATCH_IN_PROGRESS
        }

        const operationFailContext = {
            userId,
            gtin,
            batchNumber,
            operation: OPERATIONS.UPDATE_BATCH_FAIL
        }

        const operationSuccessContext = {
            userId,
            gtin,
            batchNumber,
            operation: OPERATIONS.UPDATE_BATCH
        }

        try {
            batch = await batchFactory.lookupBatch(domain, subdomain, gtin, batchNumber, version);
            if (!batch) {
                //if we don't have a batch to update ...
                await this.addBatch(domain, subdomain, gtin, batchNumber, batchMessage, req, res);
                return;
            }
        } catch (e) {
            logger.error(e);
            res.send(500, e.message);
            return;
        }

        let auditId;
        try {
            auditId = await auditService.auditOperationInProgress(operationInProgressContext);
        } catch (err) {
            logger.error(err);
            res.send(500, "Failed to audit start of an operation");
            return;
        }

        try {
            batch.update(batchData);
            try {
                await batch.persist(operationSuccessContext);
            } catch (err) {
                logger.error(err);
                await auditService.auditFail(auditId, operationFailContext);
                res.send(529, err.message);
                return;
            }
            await auditService.auditBatch(auditId, JSON.parse(JSON.stringify(batch)), operationSuccessContext);
        } catch (err) {
            logger.error(err);
            await auditService.auditFail(auditId, operationFailContext);
            res.send(500);
            return;
        }

        res.send(200);
    }

    this.getBatch = async function (domain, subdomain, gtin, batchNumber, req, res) {
        let batch;
        batch = await batchFactory.lookupBatch(domain, subdomain, gtin, batchNumber, version);

        if (!batch) {
            //if we don't have a batch...
            res.send(404, "Batch not found");
            return;
        }

        return JSON.stringify(batch);
    }

    this.listBatches = async (start, number, query, sort) => {
        const products = await $$.promisify(enclave.filter)($$.SYSTEM_IDENTIFIER, constants.TABLES.PRODUCTS);
        const productDictionary = {};
        products.forEach(product => {
            productDictionary[product.productCode] = product;
        });
        const batches = await $$.promisify(enclave.filter)($$.SYSTEM_IDENTIFIER, constants.TABLES.BATCHES, query, sort, number);
        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            const product = productDictionary[batch.productCode];
            if (product) {
                batch.inventedName = product.inventedName;
                batch.nameMedicinalProduct = product.nameMedicinalProduct;
            }
        }
        return batches;
    }

    this.listLanguages = async (domain, subdomain, gtin, batchNumber, epiType, req, res) => {
        let batch;
        batch = await batchFactory.lookupBatch(domain, subdomain, gtin, batchNumber, version);

        if (!batch) {
            res.send(404, "Batch not found");
            return;
        }

        const languages = await batch.listLanguages(epiType, batchNumber);
        return languages;
    };

    this.tryToDigest = async function (domain, subdomain, message, req, res) {
        try {
            await validationService.validateBatchMessage(message);
            let batchNumber = message.payload.batchNumber;
            if (await batchFactory.lookupBatch(domain, subdomain, batchNumber)) {
                await this.updateBatch(domain, subdomain, batchNumber, message, req, res);
                return true;
            } else {
                await this.addBatch(domain, subdomain, batchNumber, message, req, res);
                return true;
            }
        } catch (err) {

        }

        return false;
    }

    this.checkObjectStatus = async function (domain, subdomain, gtin, batchNumber) {
        return await batchFactory.checkObjectStatus(domain, subdomain, gtin, batchNumber, version);
    }

    this.recover = async function (domain, subdomain, gtin, batchNumber, req, res) {
        let auditId;
        const userId = req.headers["user-id"];
        let operationInProgressContext = {
            operation: OPERATIONS.BATCH_RECOVERY_IN_PROGRESS,
            gtin,
            batchNumber,
            userId
        }
        try {
            auditId = await auditService.auditOperationInProgress(operationInProgressContext);
        } catch (err) {
            logger.error(err);
            res.send(500, "Failed to audit start of an operation");
            return;
        }

        let batchNewVersion;
        try {
            batchNewVersion = await recoveryUtils.runRecovery(version, gtin, batchNumber);
        } catch (err) {
            let auditContext = {
                operation: OPERATIONS.BATCH_RECOVERY_FAIL,
                gtin,
                batchNumber,
                userId
            }

            try {
                await auditService.auditFail(auditId, auditContext);
            } catch (err) {
                logger.error(err);
                res.send(500, "Failed to audit failed result of an operation");
                return;
            }
            res.send(424, err.message);
            return;
        }

        if (batchNewVersion) {
            let auditContext = {
                reason: `The batch ${batchNumber} for GTIN ${gtin} got recovered as version ${batchNewVersion}.`,
                gtin,
                batchNumber,
                userId,
                version: batchNewVersion
            }

            try {
                await auditService.auditSuccess(auditId, auditContext);
            } catch (err) {
                logger.error(err);
                res.send(500, "Failed to audit success result of an operation");
                return;
            }
        } else {
            let auditContext = {
                operation: OPERATIONS.RECOVERED_BATCH,
                gtin,
                batchNumber,
                userId
            }

            try {
                await auditService.auditSuccess(auditId, auditContext);
            } catch (err) {
                logger.error(err);
                res.send(500, "Failed to audit result of an operation");
                return;
            }
        }

        res.send(200);
    }
}

let instances = {};

function getInstance(enclave, version) {
    if (!instances[version]) {
        instances[version] = new BatchController(enclave, version);
    }

    return instances[version];
}

module.exports = {
    getInstance
}