const constants = require("./constants");

class LogService {
    constructor(logsTable) {
        if (typeof logsTable === "undefined") {
            this.logsTable = constants.LOGS_TABLE;
        } else {
            this.logsTable = logsTable;
        }
    }

    log(logDetails, callback) {
        if (logDetails === null || logDetails === undefined) {
            return;
        }

        let log = {
            ...logDetails,
            timestamp: logDetails.timestamp || new Date().getTime(),
        };

        try {
            log.itemCode = logDetails.itemCode || logDetails.metadata.gtin || "unknown";
        } catch (e) {
            log.itemCode = "unknown";
        }
        return this.persistLog(log, callback);
    }

    loginLog(logDetails, callback) {
        let log = {
            ...logDetails,
            logISODate: new Date().toISOString(),
        };
        return this.persistLog(log, callback);
    }

    getLogs(callback) {
        this.getSharedStorage((err, storageService) => {
            if (err) {
                return callback(err);
            }
            storageService.filter(this.logsTable, "__timestamp > 0", callback);
        });
    }

    persistLog(log, callback) {
        this.getSharedStorage((err, storageService) => {
            if (err) {
                return callback(err);
            }

            const crypto = require("opendsu").loadAPI("crypto");
            storageService.startOrAttachBatch((err, batchId) => {
                if (err) {
                    return callback(err);
                }
                storageService.insertRecord(this.logsTable, crypto.encodeBase58(crypto.generateRandom(32)), log, (err) => {
                    if (err) {
                        return callback(err);
                    }
                    storageService.commitBatch(batchId, callback);
                });
            });
        });
    }

    getSharedStorage(callback) {
        if (typeof this.storageService !== "undefined") {
            return callback(undefined, this.storageService);
        }
        const openDSU = require("opendsu");
        const scAPI = openDSU.loadAPI("sc");
        scAPI.getSharedEnclave((err, sharedEnclave) => {
            if (err) {
                return callback(err);
            }

            sharedEnclave.addIndex(this.logsTable, "__timestamp", (error) => {
                if (error) {
                    return callback(error);
                }
                sharedEnclave.addIndex(this.logsTable, "auditId", (error) => {
                    if (error) {
                        return callback(error);
                    }
                    this.storageService = sharedEnclave;
                    callback(undefined, this.storageService);
                });
            });
        });
    }
}

class DummyLogService {
    constructor(logsTable) {
    }

    log(logDetails, callback) {
        callback();
    }

    loginLog(logDetails, callback) {
        callback();
    }

    getLogs(callback) {
        callback(undefined, []);
    }

    persistLog(log, callback) {
        callback();
    }

    getSharedStorage(callback) {
        if (typeof this.storageService !== "undefined") {
            return callback(undefined, this.storageService);
        }
        const openDSU = require("opendsu");
        const scAPI = openDSU.loadAPI("sc");
        scAPI.getSharedEnclave((err, sharedEnclave) => {
            if (err) {
                return callback(err);
            }

            sharedEnclave.addIndex(this.logsTable, "__timestamp", (error) => {
                if (error) {
                    return callback(error);
                }
                sharedEnclave.addIndex(this.logsTable, "auditId", (error) => {
                    if (error) {
                        return callback(error);
                    }
                    this.storageService = sharedEnclave;
                    callback(undefined, this.storageService);
                });
            });
        });
    }
}

// module.exports = LogService;
module.exports = DummyLogService;
