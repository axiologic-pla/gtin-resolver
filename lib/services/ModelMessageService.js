const modelToMessageMap = {
    "product": {
        name: "inventedName",
        gtin: "productCode",
        description: "nameMedicinalProduct",
        manufName: "manufName",
        reportURL: function (param) {
            if (param.direction === "toMsg") {
                return "adverseEventReportingURL"
            }
            if (typeof window !== "undefined" && window.top) {
                param.obj['reportURL'] = `${window.top.location.origin}/default-report.html`;
            }
            param.obj['reportURL'] = param.msg["adverseEventReportingURL"];
        },
        antiCounterfeitingURL: function (param) {
            if (param.direction === "toMsg") {
                return "acfProductCheckURL"
            }
            if (typeof window !== "undefined" && window.top) {
                param.obj['antiCounterfeitingURL'] = `${window.top.location.origin}/default-anti-counterfeiting.html`;
            }
            param.obj['antiCounterfeitingURL'] = param.msg["acfProductCheckURL"];
        },
        adverseEventsReportingEnabled: "flagEnableAdverseEventReporting",
        antiCounterfeitingEnabled: "flagEnableACFProductCheck",
        practitionerInfo: function (param) {
            if (param.direction === "toMsg") {
                return "healthcarePractitionerInfo"
            }
            param.obj["practitionerInfo"] = param.msg["healthcarePractitionerInfo"] || "SmPC";

        },
        patientLeafletInfo: function (param) {
            if (param.direction === "toMsg") {
                return "patientSpecificLeaflet"
            }
            param.obj["patientLeafletInfo"] = param.msg["patientSpecificLeaflet"] || "Patient Information";
        },
        markets: "markets",
        internalMaterialCode: "internalMaterialCode",
        strength: "strength",
    },
    "batch": {
        gtin: "productCode",
        batchNumber: "batch",
        expiry: function (param) {
            if (param.direction === "toMsg") {
                return "expiryDate"
            }
            param.obj['expiry'] = param.msg["expiryDate"];
            try {
                const y = param.msg.expiryDate.slice(0, 2);
                const m = param.msg.expiryDate.slice(2, 4);
                let d = param.msg.expiryDate.slice(4, 6);
                const lastMonthDay = ("0" + new Date(y, m, 0).getDate()).slice(-2);
                if (d === '00') {
                    param.obj.enableExpiryDay = false;
                    d = lastMonthDay;
                } else {
                    param.obj.enableExpiryDay = true;
                }
                const localDate = new Date(Date.parse(m + '/' + d + '/' + y));
                const gmtDate = new Date(localDate.getFullYear() + '-' + m + '-' + d + 'T00:00:00Z');
                param.obj.expiryForDisplay = gmtDate.getTime();
            } catch (e) {
                throw new Error(`${param.msg.expiryDate} date is invalid`, e);
            }
        },
        serialNumbers: "snValid",
        recalledSerialNumbers: "snRecalled",
        decommissionedSerialNumbers: function (param) {
            if (param.direction === "toMsg") {
                return param.obj.decommissionReason ? "snDecom " + param.obj.decommissionReason : "snDecom";
            }
            const decomKey = Object.keys(param.msg).find((key) => key.includes("snDecom"));
            if (!decomKey) {
                return
            }
            const keyArr = decomKey.split(" ");
            if (keyArr.length === 2) {
                param.obj.decommissionReason = keyArr[1];
            } else {
                param.obj.decommissionReason = "unknown";
            }
            param.obj.decommissionedSerialNumbers = param.msg[decomKey];
        },
        recalled: "flagEnableBatchRecallMessage",
        serialCheck: "flagEnableSNVerification",
        incorrectDateCheck: "flagEnableEXPVerification",
        expiredDateCheck: "flagEnableExpiredEXPCheck",
        recalledMessage: "recallMessage",
        defaultMessage: "batchMessage",
        packagingSiteName: "packagingSiteName",
        flagEnableACFBatchCheck: "flagEnableACFBatchCheck",
        // ACDC PATCH START
        acdcAuthFeatureSSI: "acdcAuthFeatureSSI",
        // ACDC PATCH END
        acfBatchCheckURL: "acfBatchCheckURL",
        snValidReset: "snValidReset",
        snRecalledReset: "snRecalledReset",
        snDecomReset: "snDecomReset"
    }
}

class ModelMessageService {
    constructor(type) {
        this.type = type;
    }

    getModelFromMessage(messageObj) {
        let destinationObj = {};
        let mappingObj = modelToMessageMap[this.type]
        for (let prop in mappingObj) {
            if (typeof mappingObj[prop] === "function") {
                mappingObj[prop]({direction: "fromMsg", "obj": destinationObj, "msg": messageObj});
            } else {
                destinationObj[prop] = messageObj[mappingObj[prop]];
            }
        }
        return destinationObj;
    }

    getMessageFromModel(sourceObj) {
        let messageObj = {};
        let mappingObj = modelToMessageMap[this.type]
        for (let prop in mappingObj) {
            if (sourceObj[prop] !== "undefined") {
                if (typeof mappingObj[prop] === "function") {
                    messageObj[mappingObj[prop]({
                        direction: "toMsg",
                        "obj": sourceObj,
                        "msg": messageObj
                    })] = sourceObj[prop];
                } else {
                    messageObj[mappingObj[prop]] = sourceObj[prop];
                }
            }
        }
        return messageObj;
    }
}


module.exports = ModelMessageService;
