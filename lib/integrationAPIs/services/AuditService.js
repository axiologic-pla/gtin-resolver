function AuditService(enclave) {
    const {getUserId} = require("../utils/getUserId");
    const {TABLES} = require("../utils/constants.js");
    const {AUDIT_LOG_TYPES} = require("../utils/constants.js");
    const crypto = require("opendsu").loadAPI("crypto");
    const validationService = require("../services/ValidationService.js").getInstance();

    const generatePK = () => {
        return crypto.generateRandom(32).toString("base64url");
    }

    const generateAuditEntry = (context) => {
        const auditEntry = {
            itemCode: context.itemCode || context.gtin,
            reason: context.reason || context.operation,
            creationTime: context.creationTime || new Date().toISOString(),
            username: context.username || context.userId,
            version: context.version
        };

        if (context.batchNumber) {
            auditEntry.batchNumber = context.batchNumber;
        }

        if (context.diffs) {
            auditEntry.details = context.diffs;
        }

        return auditEntry;
    }

    this.auditProduct = async (auditId, productPayload, context) => {
        if (context && context.version) {
            //if we find a version in the context, that version is read from blockchain so we should keep it also into the database for UI reasons
            productPayload.version = context.version;
        }
        try {
            await $$.promisify(enclave.insertRecord)($$.SYSTEM_IDENTIFIER, TABLES.PRODUCTS, productPayload.productCode, productPayload);
        } catch (error) {
            await $$.promisify(enclave.updateRecord)($$.SYSTEM_IDENTIFIER, TABLES.PRODUCTS, productPayload.productCode, productPayload);
        }

        await this.auditSuccess(auditId, context);
    }

    this.auditProductVersionChange = async (productCode, newVersion) => {
        let product = await $$.promisify(enclave.getRecord)($$.SYSTEM_IDENTIFIER, TABLES.PRODUCTS, productCode);
        product.version = newVersion;
        await $$.promisify(enclave.updateRecord)($$.SYSTEM_IDENTIFIER, TABLES.PRODUCTS, productCode, product);
    }

    this.auditBatch = async (auditId, batchPayload, context) => {
        const pk = `${batchPayload.productCode}_${batchPayload.batch}`;
        if (context && context.version) {
            //if we find a version in the context, that version is read from blockchain so we should keep it also into the database for UI reasons
            batchPayload.version = context.version;
        }
        try {
            await $$.promisify(enclave.insertRecord)($$.SYSTEM_IDENTIFIER, TABLES.BATCHES, pk, batchPayload);
        } catch (error) {
            await $$.promisify(enclave.updateRecord)($$.SYSTEM_IDENTIFIER, TABLES.BATCHES, pk, batchPayload);
        }

        await this.auditSuccess(auditId, context);
    }

    this.auditBatchVersionChange = async (productCode, batchNumber, newVersion) => {
        const pk = `${productCode}_${batchNumber}`;
        let batch = await $$.promisify(enclave.getRecord)($$.SYSTEM_IDENTIFIER, TABLES.BATCHES, pk);
        batch.version = newVersion;
        await $$.promisify(enclave.updateRecord)($$.SYSTEM_IDENTIFIER, TABLES.BATCHES, pk, batch);
    }

    this.auditFail = async (auditId, context) => {
        await $$.promisify(enclave.updateRecord)($$.SYSTEM_IDENTIFIER, TABLES.AUDIT, auditId, generateAuditEntry(context));
    }

    this.auditOperationInProgress = async (context) => {
        const auditId = generatePK();
        await $$.promisify(enclave.insertRecord)($$.SYSTEM_IDENTIFIER, TABLES.AUDIT, auditId, generateAuditEntry(context));
        return auditId;
    }

    this.addLog = async (logType, auditMessage, req, res) => {
        const username = getUserId(req, auditMessage);


        let auditData = {username, ...auditMessage.payload};

        if (logType === AUDIT_LOG_TYPES.USER_ACCESS) {
            //TODO: we should check the user who authorized this call is the one that appers in the audit entry
            try {
                await validationService.validateAuditUserAccessMessage(auditMessage);
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
            return await this.insertRecordToAudit(TABLES.USER_ACCESS, auditData);
        }

        try {
            await validationService.validateAuditUserActionMessage(auditMessage);
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
        await this.insertRecordToAudit(TABLES.AUDIT, auditData);
    }

    this.insertRecordToAudit = async (tableName, auditData) => {
        const auditId = generatePK();
        await $$.promisify(enclave.insertRecord)($$.SYSTEM_IDENTIFIER, tableName, auditId, auditData);
        return auditId;
    }

    this.auditSuccess = async (auditId, context) => {
        await $$.promisify(enclave.updateRecord)($$.SYSTEM_IDENTIFIER, TABLES.AUDIT, auditId, generateAuditEntry(context));
    }

    this.filterAuditLogs = async (logType, start, number, query, sort) => {
        let table;
        if (logType === AUDIT_LOG_TYPES.USER_ACCESS) {
            table = TABLES.USER_ACCESS
        }
        if (logType === AUDIT_LOG_TYPES.USER_ACTION) {
            table = TABLES.AUDIT
        }
        return await $$.promisify(enclave.filter)($$.SYSTEM_IDENTIFIER, table, query, sort, number);
    }
}

let serviceInstance;

function getInstance(enclave) {
    if (!serviceInstance) {
        serviceInstance = new AuditService(enclave);
    }
    return serviceInstance;
}

module.exports = {
    getInstance
};
