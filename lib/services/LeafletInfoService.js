const {createGTIN_SSI} = require("./../GTIN_SSI");
const LeafletFeatureManager = require("./../LeafletFeatureManager");
const constants = require("../constants/constants");
const versionTransformerUtils = require("../EpiVersionTransformer");
const utils = require("../utils/CommonUtils");
const openDSU = require("opendsu");
const resolver = openDSU.loadAPI("resolver");

class LeafletInfoService {
    constructor(gs1Fields, networkName, epiProtocolVersion) {
        this.gs1Fields = gs1Fields;
        this.gtin = gs1Fields.gtin;
        this.batch = gs1Fields.batchNumber;
        this.networkName = networkName;
        this.gtinSSI = this.getLeafletGtinSSI();
        this.epiProtocolVersion = epiProtocolVersion;
    }

    static async init(gs1Fields, networkName) {
        let epiProtocolVersion = await LeafletFeatureManager.getEpiProtocolVersion();
        return new LeafletInfoService(gs1Fields, networkName, epiProtocolVersion);
    }

    getLeafletGtinSSI = () => {
        let gtinSSI = createGTIN_SSI(this.networkName, undefined, this.gtin, this.batch);
        return gtinSSI;
    }

    checkBatchAnchorExists(callback) {
        let anchorCheckTimeoutFlag = false;
        setTimeout(() => {
            if (!anchorCheckTimeoutFlag) {
                anchorCheckTimeoutFlag = true;
                return callback(undefined, false);
            }
        }, constants.ANCHOR_CHECK_TIMEOUT)
        resolver.loadDSU(this.gtinSSI.getIdentifier(), (err) => {
            if (anchorCheckTimeoutFlag) {
                return;
            }
            anchorCheckTimeoutFlag = true;
            if (err) {
                return callback(undefined, false);
            }
            callback(undefined, true);
        });
    }

    checkConstProductDSUExists(callback) {
        let anchorCheckTimeoutFlag = false;
        setTimeout(() => {
            if (!anchorCheckTimeoutFlag) {
                anchorCheckTimeoutFlag = true;
                return callback(undefined, false);
            }
        }, constants.ANCHOR_CHECK_TIMEOUT)
        //this is called in gtin only case (batch not found)
        this.gtinSSI = createGTIN_SSI(this.networkName, undefined, this.gtin);
        resolver.loadDSU(this.gtinSSI.getIdentifier(), (err) => {
            if (anchorCheckTimeoutFlag) {
                return;
            }
            anchorCheckTimeoutFlag = true;
            if (err) {
                return callback(undefined, false);
            }
            callback(undefined, true);
        });
    }

    readProductData(callback) {
        const gtinSSI = createGTIN_SSI(this.networkName, undefined, this.gtin);
        resolver.loadDSU(gtinSSI, async (err, dsu) => {
            if (err) {
                return callback(err);
            }
            try {
                let productData = await $$.promisify(dsu.readFile)(versionTransformerUtils.getProductPath(this.epiProtocolVersion));
                if (typeof productData === "undefined") {
                    return callback(Error(`Product data is undefined.`));
                }
                productData = JSON.parse(productData.toString());
                try {
                    let imgFile = await $$.promisify(dsu.readFile)(versionTransformerUtils.getProductImagePath(this.epiProtocolVersion));
                    productData.productPhoto = utils.getImageAsBase64(imgFile)
                } catch (err) {
                    productData.productPhoto = constants.HISTORY_ITEM_DEFAULT_ICON;
                }
                callback(undefined, productData);
            } catch (err) {
                return callback(err);
            }
        });
    }

    readBatchData(callback) {
        resolver.loadDSU(this.gtinSSI, (err, dsu) => {
            if (err) {
                return callback(err);
            }
            dsu.readFile(versionTransformerUtils.getBatchPath(this.epiProtocolVersion), (err, batchData) => {
                if (err) {
                    return callback(err);
                }
                if (typeof batchData === "undefined") {
                    return callback(Error(`Batch data is undefined`));
                }
                batchData = JSON.parse(batchData.toString());
                callback(undefined, batchData);
            });
        });
    }

    async disableFeatures(model) {
        let disabledFeatures = await LeafletFeatureManager.getLeafletDisabledFeatures();
        if (!disabledFeatures || disabledFeatures.length === 0) {
            return;
        }
        let disabledFeaturesKeys = [];
        disabledFeatures.forEach(code => {
            disabledFeaturesKeys = disabledFeaturesKeys.concat(constants.DISABLED_FEATURES_MAP[code].modelProperties);

        });
        Object.keys(model).forEach(key => {
            if (disabledFeaturesKeys.find(item => item === key)) {
                model[key] = null;
            }
        })
    }

    getBatchClientModel = async () => {
        let self = this;
        return new Promise(function (resolve, reject) {
            self.readBatchData(async (err, batchModel) => {
                if (err) {
                    return reject(err);
                }
                if (typeof batchModel === "undefined") {
                    return reject(new Error("Could not find batch"));
                }
                if (`v${self.epiProtocolVersion}` === batchModel.epiProtocol) {
                    await self.disableFeatures(batchModel);
                    return resolve(batchModel)
                } else {
                    // TO DO: transform model to this.epiProtocolVersion
                    return reject(new Error(`Version incompatibility. Current version is ${self.epiProtocolVersion} and dsu version is ${batchModel.epiProtocol}`));
                }

            })
        })
    }

    getProductClientModel = async () => {
        let self = this;
        return new Promise(function (resolve, reject) {
            self.readProductData(async (err, productModel) => {
                if (err) {
                    return reject(err);
                }
                if (typeof productModel === "undefined") {
                    return reject(new Error("Could not find batch"));
                }
                if (`v${self.epiProtocolVersion}` === productModel.epiProtocol) {
                    await self.disableFeatures(productModel)
                    return resolve(productModel)
                } else {
                    // TO DO: transform model to this.epiProtocolVersion
                    return reject(new Error(`Version incompatibility. Current version is ${self.epiProtocolVersion} and dsu version is ${productModel.epiProtocol}`));
                }
            })
        })
    }

    leafletShouldBeDisplayed(model, expiryCheck, currentTime) {
        let batchData = model.batch;
        let snCheck = model.snCheck;
        let expiryTime = model.expiryTime;

        if (batchData.serialCheck && !snCheck.validSerial && !snCheck.recalledSerial && !snCheck.decommissionedSerial) {
            return true;
        }

        if (batchData.serialCheck && typeof model.serialNumber === "undefined") {
            return true;
        }

        if (batchData.serialCheck && snCheck.recalledSerial) {
            return true;
        }

        if (batchData.serialCheck && snCheck.decommissionedSerial) {
            return true;
        }

        if (!batchData.expiredDateCheck && !batchData.incorrectDateCheck && !batchData.serialCheck) {
            return true;
        }

        if (batchData.expiredDateCheck && currentTime < expiryTime && !batchData.incorrectDateCheck && !batchData.serialCheck) {
            return true;
        }

        if (batchData.expiredDateCheck && expiryTime < currentTime && !batchData.incorrectDateCheck && !batchData.serialCheck) {
            return true;
        }

        if (batchData.incorrectDateCheck && !expiryCheck && !batchData.serialCheck && !batchData.serialCheck) {
            return true;
        }

        if (!batchData.expiredDateCheck && batchData.incorrectDateCheck && expiryCheck && !batchData.serialCheck) {
            return true;
        }

        if (batchData.expiredDateCheck && currentTime < expiryTime && batchData.incorrectDateCheck && expiryCheck && !batchData.serialCheck) {
            return true;
        }

        if (batchData.expiredDateCheck && expiryTime < currentTime && batchData.incorrectDateCheck && expiryCheck && !batchData.serialCheck) {
            return true;
        }

        if (batchData.expiredDateCheck && currentTime < expiryTime && !batchData.incorrectDateCheck && batchData.serialCheck && snCheck.validSerial) {
            return true;
        }

        if (batchData.expiredDateCheck && expiryTime < currentTime && !batchData.incorrectDateCheck && batchData.serialCheck && snCheck.validSerial) {
            return true;
        }

        if (batchData.expiredDateCheck && currentTime < expiryTime && batchData.incorrectDateCheck && expiryCheck && batchData.serialCheck && snCheck.validSerial && batchData.recalled) {
            return true;
        }

        if (batchData.expiredDateCheck && currentTime < expiryTime && batchData.incorrectDateCheck && expiryCheck && batchData.serialCheck && snCheck.validSerial && !batchData.recalled) {
            return true;
        }

        if (batchData.expiredDateCheck && expiryTime < currentTime && batchData.incorrectDateCheck && expiryCheck
            && batchData.serialCheck && snCheck.validSerial) {
            return true;
        }

        if (batchData.incorrectDateCheck && !expiryCheck && batchData.serialCheck && snCheck.validSerial) {
            return true;
        }

        if (!batchData.expiredDateCheck && !batchData.incorrectDateCheck && batchData.serialCheck && snCheck.validSerial) {
            return true;
        }

        if (!batchData.expiredDateCheck && batchData.incorrectDateCheck && expiryCheck && batchData.serialCheck && snCheck.validSerial) {
            return true;
        }

        return false;
    }
}

module.exports = LeafletInfoService;


